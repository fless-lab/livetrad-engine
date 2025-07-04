import { WebSocketService } from '../services/websocket';
import { AudioService } from '../services/audio';
import { AudioCaptureService } from '../services/audioCaptureService';
import { defaultWebSocketConfig } from '../config/websocket.config';
import { ConnectionState, AudioSource } from '../types';
import { defaultConfig, audioSourceDomains } from '../config/audio.config';

type FilterType = 'all' | 'with-audio' | 'without-audio';

class Sidebar {
    private wsService: WebSocketService;
    private audioService: AudioService;
    private streaming: boolean = false;
    private currentFilter: FilterType = 'all';
    private currentSources: AudioSource[] = [];
    private showAllTabs: boolean = defaultConfig.showAllTabs;
    private selectedTabId: string | null = null;

    private elements = {
        connectButton: document.getElementById('connectButton') as HTMLButtonElement,
        connectButtonText: document.getElementById('connectButtonText') as HTMLElement,
        statusDot: document.querySelector('.status-dot') as HTMLElement,
        statusText: document.querySelector('.status-text') as HTMLElement,
        sourcesList: document.getElementById('sourcesList') as HTMLElement,
        sourceCount: document.getElementById('sourceCount') as HTMLElement,
        noSourcesMessage: document.getElementById('noSourcesMessage') as HTMLElement,
        startStreamingButton: document.getElementById('startStreamingButton') as HTMLButtonElement,
        streamingStatus: document.getElementById('streamingStatus') as HTMLElement,
        statusMessage: document.getElementById('statusMessage') as HTMLElement,
        streamingSection: document.querySelector('.streaming-section') as HTMLElement,
        sourcesContainer: document.querySelector('.sources-container') as HTMLElement,
        filterButtons: document.querySelectorAll('.filter-button') as NodeListOf<HTMLButtonElement>,
        showAllTabsCheckbox: document.getElementById('showAllTabs') as HTMLInputElement
    };

    private audioCaptureService: AudioCaptureService;

    constructor() {
        // Vérifier que tous les éléments sont trouvés
        for (const [key, element] of Object.entries(this.elements)) {
            if (!element) {
                console.error(`Element not found: ${key}`);
            }
        }

        this.wsService = new WebSocketService(defaultWebSocketConfig);
        this.audioService = new AudioService();
        this.audioCaptureService = new AudioCaptureService();
        this.initializeEventListeners();
        this.initializeIntersectionObserver();

        this.elements.showAllTabsCheckbox.checked = this.showAllTabs;
        this.elements.showAllTabsCheckbox.addEventListener('change', (e) => {
            this.showAllTabs = (e.target as HTMLInputElement).checked;
            this.updateSourcesList();
        });
    }

    private initializeEventListeners() {
        // WebSocket connection events
        this.elements.connectButton.addEventListener('click', this.handleConnectionClick.bind(this));

        // Audio source selection events
        this.audioService.on('sources-changed', (sources: AudioSource[]) => {
            this.currentSources = sources;
            this.updateSourcesList();
        });

        // Streaming control events
        this.elements.startStreamingButton.addEventListener('click', this.toggleStreaming.bind(this));

        // Filter events
        this.elements.filterButtons.forEach(button => {
            button.addEventListener('click', () => {
                const filter = button.dataset.filter as FilterType;
                this.setFilter(filter);
            });
        });

        // Initial states
        this.updateConnectionStatus(this.wsService.getConnectionState());
    }

    private initializeIntersectionObserver() {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) {
                        this.elements.streamingSection.classList.add('fixed');
                    } else {
                        this.elements.streamingSection.classList.remove('fixed');
                    }
                });
            },
            {
                root: null,
                threshold: 1.0
            }
        );

        // Observer le bas de la liste des sources
        observer.observe(this.elements.sourcesContainer);
    }

    private setFilter(filter: FilterType) {
        this.currentFilter = filter;
        
        // Update filter buttons
        this.elements.filterButtons.forEach(button => {
            if (button.dataset.filter === filter) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });

        this.updateSourcesList();
    }

    private filterSources(sources: AudioSource[]): AudioSource[] {
        switch (this.currentFilter) {
            case 'with-audio':
                return sources.filter(source => source.isAudible);
            case 'without-audio':
                return sources.filter(source => !source.isAudible);
            default:
                return sources;
        }
    }

    private async handleConnectionClick() {
        const button = this.elements.connectButton;
        const currentState = this.wsService.getConnectionState();

        if (currentState.status === 'connected') {
            // Déconnexion
            button.classList.add('disconnecting');
            this.elements.connectButtonText.textContent = 'Disconnecting...';
            this.wsService.disconnect();
            this.updateConnectionStatus(this.wsService.getConnectionState());
            button.classList.remove('disconnecting');
        } else {
            // Connexion
            button.classList.add('connecting');
            this.elements.connectButtonText.textContent = 'Connecting...';
            
            try {
                const newState = await this.wsService.connect();
                this.updateConnectionStatus(newState);
            } catch (error) {
                console.error('Connection error:', error);
                this.updateConnectionStatus({
                    status: 'disconnected',
                    desktopUrl: this.wsService.getConnectionState().desktopUrl
                });
            }
            
            button.classList.remove('connecting');
        }
    }

    private updateConnectionStatus(state: ConnectionState) {
        const isConnected = state.status === 'connected';
        
        this.elements.statusDot.className = `status-dot ${state.status}`;
        this.elements.statusText.textContent = state.status;
        this.elements.connectButtonText.textContent = isConnected ? 'Disconnect' : 'Connect';
        
        this.updateStreamingButtonState();
    }

    private updateSourcesList() {
        chrome.tabs.query({}, async (tabs) => {
            let filteredTabs = tabs;
            
            // Si la case n'est PAS cochée, on applique le filtre restrictif
            if (!this.showAllTabs) {
                filteredTabs = tabs.filter(tab => {
                    const url = tab.url || '';
                    return audioSourceDomains.some(domain => url.includes(domain)) || tab.audible;
                });
            }
    
            // Mise à jour de l'affichage selon le filtre actuel
            if (this.currentFilter === 'with-audio') {
                filteredTabs = filteredTabs.filter(tab => tab.audible);
            } else if (this.currentFilter === 'without-audio') {
                filteredTabs = filteredTabs.filter(tab => !tab.audible);
            }
    
            const sourcesList = this.elements.sourcesList;
            if (!sourcesList) return;
    
            sourcesList.innerHTML = '';
            filteredTabs.forEach(tab => {
                const sourceItem = document.createElement('div');
                sourceItem.className = 'source-item';
                if (tab.audible) sourceItem.classList.add('has-audio');
                if (tab.id === Number(this.selectedTabId)) sourceItem.classList.add('selected');
                
                // Disable selection if streaming is active and this is not the current streaming source
                if (this.streaming && tab.id !== Number(this.selectedTabId)) {
                    sourceItem.classList.add('disabled');
                }
    
                // Ajouter le radio indicator
                const radioIndicator = document.createElement('span');
                radioIndicator.className = 'radio-indicator';
                sourceItem.appendChild(radioIndicator);
    
                // Favicon ou icône par défaut
                const favicon = document.createElement('img');
                favicon.src = tab.favIconUrl || 'default-icon.png';
                favicon.className = 'source-icon';
                favicon.onerror = () => {
                    favicon.outerHTML = '<span class="source-icon material-icons-round">tab</span>';
                };
                sourceItem.appendChild(favicon);
    
                // Titre de l'onglet
                const titleSpan = document.createElement('span');
                titleSpan.className = 'source-title';
                titleSpan.textContent = tab.title || 'Sans titre';
                sourceItem.appendChild(titleSpan);
    
                // Gestion de la sélection
                sourceItem.addEventListener('click', async () => {
                    if (!tab.id) return;

                    // If streaming is active and trying to select a different source
                    if (this.streaming && tab.id !== Number(this.selectedTabId)) {
                        this.elements.statusMessage.textContent = 'Please stop the current stream before selecting a new source';
                        return;
                    }

                    // Désélectionner l'ancien
                    const oldSelected = sourcesList.querySelector('.selected');
                    if (oldSelected) {
                        oldSelected.classList.remove('selected');
                    }

                    // Sélectionner le nouveau
                    sourceItem.classList.add('selected');
                    this.selectedTabId = String(tab.id);
                    this.audioService.selectSource(String(tab.id));
                    this.updateStreamingButtonState();
                });
    
                sourcesList.appendChild(sourceItem);
            });
    
            // Update source count
            if (this.elements.sourceCount) {
                this.elements.sourceCount.textContent = `${filteredTabs.length} source${filteredTabs.length !== 1 ? 's' : ''}`;
            }
    
            // Mise à jour du message si aucune source
            const noSourcesMessage = this.elements.noSourcesMessage;
            if (noSourcesMessage) {
                noSourcesMessage.style.display = filteredTabs.length === 0 ? 'block' : 'none';
            }
        });
    }

    private async updateStreamingButtonState() {
        const selectedSource = this.audioService.getSelectedSource();
        console.log("Selected Source is : ", selectedSource);
        const canStream = this.wsService.getConnectionState().status === 'connected' 
            && selectedSource !== null;

        // Enable streaming for any selected source when connected
        this.elements.startStreamingButton.disabled = !canStream;
        
        if (!canStream) {
            this.elements.startStreamingButton.innerHTML = `
                <span class="button-icon">🎙️</span>
                Start Streaming
            `;
            this.elements.statusMessage.textContent = selectedSource ? 
                'Connect to start streaming' : 
                'Select a source and connect to start streaming';
            this.elements.streamingStatus.classList.remove('streaming-active');
        } else if (this.streaming && this.selectedTabId) {
            // Get the current streaming tab's title
            try {
                const streamingTab = await chrome.tabs.get(Number(this.selectedTabId));
                this.elements.startStreamingButton.innerHTML = `
                    <span class="button-icon">⏹️</span>
                    Stop Streaming (${streamingTab.title || 'Unknown'})
                `;
            } catch (error) {
                console.error('Error getting streaming tab info:', error);
            }
    }}

    private async toggleStreaming() {
        if (!this.selectedTabId) return;

        try {
            // Check if we're trying to capture a restricted page
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const currentTab = tabs[0];
            const restrictedUrls = ['chrome://', 'chrome-extension://', 'edge://', 'about:'];
            
            if (currentTab && currentTab.url && restrictedUrls.some(prefix => currentTab.url?.startsWith(prefix))) {
                throw new Error('This page cannot be captured due to browser security restrictions. Please select a different tab.');
            }

            if (this.streaming) {
                // Stop streaming
                const response = await this.audioCaptureService.stopStreaming(Number(this.selectedTabId));
                if (!response.success) {
                    throw new Error(response.error);
                }
                this.streaming = false;
                this.elements.startStreamingButton.innerHTML = `
                    <span class="button-icon">🎙️</span>
                    Start Streaming
                `;
                this.elements.statusMessage.textContent = 'Streaming stopped';
                this.elements.streamingStatus.classList.remove('streaming-active');
            } else {
                // Get the selected tab information
                const selectedTab = await chrome.tabs.get(Number(this.selectedTabId));
                
                // Check if the selected tab is loaded
                if (!selectedTab.url || selectedTab.status !== 'complete') {
                    throw new Error('Please wait for the tab to finish loading before capturing audio.');
                }

                // Check if we're trying to capture a restricted URL
                if (restrictedUrls.some(prefix => selectedTab.url?.startsWith(prefix))) {
                    throw new Error('This page cannot be captured due to browser security restrictions. Please select a different tab.');
                }

                // Inform user about tab switching
                const activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
                if (selectedTab.id !== activeTab.id) {
                    this.elements.statusMessage.textContent = 'Switching to the selected tab (required for audio capture)...';
                }

                // Activate the tab and wait for it to be ready
                try {
                    await chrome.tabs.update(Number(this.selectedTabId), { active: true });
                    // Wait for the tab to be fully activated
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (error) {
                    console.warn('Failed to activate tab:', error);
                    throw new Error('Failed to activate the selected tab. Please try again.');
                }

                // Request tab capture permission
                const stream = await new Promise<MediaStream>((resolve, reject) => {
                    chrome.tabCapture.capture(
                        { 
                            audio: true,
                            video: false,
                            audioConstraints: {
                                mandatory: {
                                    chromeMediaSource: 'tab'
                                }
                            }
                        },
                        (stream) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                            } else if (!stream) {
                                reject(new Error('Failed to capture tab audio. Please ensure you have granted the necessary permissions and the tab is active.'));
                            } else {
                                resolve(stream);
                            }
                        }
                    );
                });

                // Start streaming
                const response = await this.audioCaptureService.startStreaming(stream, Number(this.selectedTabId));
                if (!response.success) {
                    throw new Error(response.error);
                }
                this.streaming = true;
                this.elements.startStreamingButton.innerHTML = `
                    <span class="button-icon">⏹️</span>
                    Stop Streaming
                `;
                this.elements.statusMessage.textContent = 'Streaming active';
                this.elements.streamingStatus.classList.add('streaming-active');
            }
        } catch (error) {
            console.error('Streaming error:', error);
            this.elements.statusMessage.textContent = `Failed to ${this.streaming ? 'stop' : 'start'} streaming: ${(error as Error).message}`;
            // Reset streaming state if we failed to start
            if (!this.streaming) {
                this.elements.startStreamingButton.innerHTML = `
                    <span class="button-icon">🎙️</span>
                    Start Streaming
                `;
                this.elements.streamingStatus.classList.remove('streaming-active');
            }
        }
    }


}

// Initialize the sidebar
new Sidebar();