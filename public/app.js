// Main App JavaScript
document.addEventListener('DOMContentLoaded', () => {
    // Initialize the app
    initApp();

    // Set up event listeners
    setupEventListeners();

    // Load honeypot number
    loadHoneypotNumber();

    // Load real dashboard data
    loadDashboardData();

    // Load leaderboard
    loadLeaderboard();

    // Set up real-time updates (SSE preferred, periodic as fallback)
    // setupPeriodicUpdates() is called automatically if SSE fails
});

// Load and display the honeypot phone number
async function loadHoneypotNumber() {
    try {
        const honeypotNumberElement = document.getElementById('honeypot-number-display');
        const copyButton = document.getElementById('copy-honeypot-btn');

        if (!honeypotNumberElement) {
            return;
        }

        // Try to get the phone number from a dedicated endpoint
        let phoneNumber = 'Not configured';

        try {
            const phoneResponse = await fetch('/honeypot-number');
            if (phoneResponse.ok) {
                const phoneData = await phoneResponse.json();
                phoneNumber = phoneData.phoneNumber || 'Not configured';
            }
        } catch (error) {
            // Fallback to hardcoded value if API fails
            phoneNumber = '+17816787111';
        }

        honeypotNumberElement.textContent = phoneNumber;

        // Set up copy functionality
        if (copyButton && phoneNumber !== 'Not configured') {
            copyButton.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(phoneNumber);

                    // Visual feedback
                    const originalIcon = copyButton.innerHTML;
                    copyButton.innerHTML = '<i class="fas fa-check"></i>';
                    copyButton.style.background = 'rgba(34, 197, 94, 0.3)';

                    setTimeout(() => {
                        copyButton.innerHTML = originalIcon;
                        copyButton.style.background = 'rgba(255, 255, 255, 0.2)';
                    }, 2000);

                } catch (error) {
                    // Fallback: select the text
                    const range = document.createRange();
                    range.selectNode(honeypotNumberElement);
                    window.getSelection().removeAllRanges();
                    window.getSelection().addRange(range);
                }
            });
        }
    } catch (error) {
        const honeypotNumberElement = document.getElementById('honeypot-number-display');
        if (honeypotNumberElement) {
            honeypotNumberElement.textContent = '+18339874597';
        }
    }
}

// App state
const appState = {
    scamCounter: 0,
    recentScams: [],
    isDetecting: true,
    currentFilter: 'all',
    audioPlayer: null,
    currentlyPlaying: null,
    liveCalls: new Map(),
    sseConnection: null,
    callDurationTimers: new Map(),
    isServerless: false // Track if we're in a serverless environment
};

// Browser notification functions
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            console.log('Notification permission:', permission);
            if (permission === 'granted') {
                showCallNotification('Notifications Enabled', 'You will now receive browser notifications for incoming calls', 'success');
            }
        });
    }
}

function showBrowserNotification(title, message, options = {}) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const defaultOptions = {
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'sip-sentinel-call',
            requireInteraction: true,
            ...options
        };

        const notification = new Notification(title, {
            body: message,
            ...defaultOptions
        });

        // Focus window when notification is clicked
        notification.onclick = function() {
            window.focus();
            notification.close();
        };

        // Auto-close after 10 seconds for non-critical notifications
        if (!options.requireInteraction) {
            setTimeout(() => {
                notification.close();
            }, 10000);
        }

        return notification;
    }
    return null;
}

function playNotificationSound() {
    // Create a simple notification sound using Web Audio API
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.2);

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
        console.log('Could not play notification sound:', error);
    }
}

// Initialize the app
function initApp() {
    console.log('Initializing Scam Shield Dashboard');

    // Request notification permission
    requestNotificationPermission();

    // Initialize the detection canvas
    initDetectionCanvas();

    // Initialize real-time updates
    initializeSSEConnection();
}

// Set up event listeners
function setupEventListeners() {
    // Filter buttons for recent scams
    document.querySelectorAll('.filter-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const filter = e.target.dataset.filter;
            setActiveFilter(filter);
            filterScamCalls(filter);
        });
    });

    // Test detection button
    const testButton = document.getElementById('test-detection-btn');
    if (testButton) {
        testButton.addEventListener('click', async () => {
            try {
                // Add visual feedback
                testButton.classList.add('active');

                // Test live detection functionality
                console.log('🧪 Testing live detection functionality...');

                // Simulate an incoming call for testing
                const testCallData = {
                    callSid: 'test-call-' + Date.now(),
                    callerNumber: '+1555XXXX123',
                    timestamp: new Date().toISOString()
                };

                // Test incoming call handler
                handleIncomingCall(testCallData);

                // After 3 seconds, simulate processing
                setTimeout(() => {
                    handleCallStatusUpdate({
                        callSid: testCallData.callSid,
                        status: 'processing',
                        message: 'Processing test voicemail for scam detection'
                    });
                }, 3000);

                // After 6 seconds, simulate scam detection
                setTimeout(() => {
                    handleScamDetected({
                        callSid: testCallData.callSid,
                        company: 'Test Exchange',
                        scamType: 'crypto_exchange',
                        confidence: 95,
                        message: 'Test scam detected successfully!'
                    });
                }, 6000);

                // After 9 seconds, clean up
                setTimeout(() => {
                    handleCallProcessed({
                        callSid: testCallData.callSid,
                        scamDetected: true,
                        message: 'Test completed - live detection is working!'
                    });
                }, 9000);

                // Also refresh the dashboard data to show latest real-time data
                await loadDashboardData();

            } catch (error) {
                console.error('Error testing live detection:', error);
            } finally {
                // Remove visual feedback
                setTimeout(() => {
                    testButton.classList.remove('active');
                }, 500);
            }
        });
    }

    // Set up VAPI management event listeners
    setupVapiEventListeners();

    // Set up debug panel toggle
    setupDebugPanelToggle();

    // Set up leaderboard refresh button
    const refreshLeaderboardBtn = document.getElementById('refresh-leaderboard-btn');
    if (refreshLeaderboardBtn) {
        refreshLeaderboardBtn.addEventListener('click', loadLeaderboard);
    }
}

// Set active filter
function setActiveFilter(filter) {
    // Update app state
    appState.currentFilter = filter;

    // Update UI
    document.querySelectorAll('.filter-btn').forEach(button => {
        if (button.dataset.filter === filter) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
}

// Filter scam calls based on type
function filterScamCalls(filter) {
    const container = document.getElementById('scam-calls-container');
    const items = container.querySelectorAll('.scam-call-item');

    items.forEach(item => {
        const itemType = item.dataset.type;
        const itemScamType = item.dataset.scamType;

        let shouldShow = false;

        if (filter === 'all') {
            shouldShow = true;
        } else if (filter === 'scam_voicemail' || filter === 'agent_conversation') {
            shouldShow = itemType === filter;
        } else {
            // Filter by scam type (crypto_exchange, it_support, banking)
            shouldShow = itemScamType === filter;
        }

        item.style.display = shouldShow ? 'flex' : 'none';
    });
}

// Filter by tag (for clickable tags)
function filterByTag(tag) {
    const container = document.getElementById('scam-calls-container');
    const items = container.querySelectorAll('.scam-call-item');

    // Update the current filter state
    appState.currentFilter = tag.toLowerCase().replace(/\s+/g, '_');

    // Clear existing filter button states
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));

    // Clear existing tag filter states
    document.querySelectorAll('.tag-item').forEach(tagEl => tagEl.classList.remove('filtered'));

    items.forEach(item => {
        const scamId = item.dataset.scamId;
        const scam = appState.recentScams.find(s => s.id === scamId);

        let shouldShow = false;

        if (scam && scam.tags) {
            // Check if any of the scam's tags match the filter
            shouldShow = scam.tags.some(scamTag =>
                scamTag.toLowerCase().includes(tag.toLowerCase()) ||
                tag.toLowerCase().includes(scamTag.toLowerCase())
            );
        } else if (scam) {
            // Fallback to checking company and agent name
            const searchText = `${scam.company} ${scam.agentName || ''}`.toLowerCase();
            shouldShow = searchText.includes(tag.toLowerCase());
        }

        item.style.display = shouldShow ? 'flex' : 'none';

        // Highlight matching tags
        if (shouldShow) {
            const tagElements = item.querySelectorAll('.tag-item');
            tagElements.forEach(tagEl => {
                if (tagEl.textContent.toLowerCase().includes(tag.toLowerCase()) ||
                    tag.toLowerCase().includes(tagEl.textContent.toLowerCase())) {
                    tagEl.classList.add('filtered');
                }
            });
        }
    });

    // Show a notification about the filter
    showFilterNotification(tag);
}

// Show filter notification
function showFilterNotification(tag) {
    const notification = document.createElement('div');
    notification.className = 'filter-notification';
    notification.innerHTML = `<i class="fas fa-filter"></i> Filtered by: <strong>${tag}</strong> <button onclick="clearFilter()" class="clear-filter-btn">Clear</button>`;

    // Remove existing notification
    const existing = document.querySelector('.filter-notification');
    if (existing) existing.remove();

    // Add to page
    const header = document.querySelector('.recent-scams-panel .panel-header');
    if (header) {
        header.appendChild(notification);
    }
}

// Clear filter
function clearFilter() {
    setActiveFilter('all');
    filterScamCalls('all');

    // Clear tag filter states
    document.querySelectorAll('.tag-item').forEach(tagEl => tagEl.classList.remove('filtered'));

    // Remove notification
    const notification = document.querySelector('.filter-notification');
    if (notification) notification.remove();
}

// Initialize the detection canvas
function initDetectionCanvas() {
    const canvas = document.getElementById('detection-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Set canvas dimensions
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Draw initial state
    drawDetectionBackground(ctx, canvas.width, canvas.height);
}

// Draw detection background
function drawDetectionBackground(ctx, width, height) {
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.5)';
    ctx.lineWidth = 1;

    // Vertical grid lines
    for (let x = 0; x < width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    // Horizontal grid lines
    for (let y = 0; y < height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    // Draw animated wave
    drawAnimatedWave(ctx, width, height);
}

// Draw animated wave
function drawAnimatedWave(ctx, width, height) {
    let offset = 0;

    function animate() {
        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Check if we're in alert mode (incoming calls)
        const hasIncomingCalls = Array.from(appState.liveCalls.values()).some(call =>
            call.status === 'ringing' || call.status === 'incoming'
        );

        // Draw grid lines with alert coloring
        if (hasIncomingCalls) {
            ctx.strokeStyle = 'rgba(255, 107, 53, 0.3)';
        } else {
            ctx.strokeStyle = 'rgba(203, 213, 225, 0.5)';
        }
        ctx.lineWidth = 1;

        // Vertical grid lines
        for (let x = 0; x < width; x += 50) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Horizontal grid lines
        for (let y = 0; y < height; y += 50) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        if (hasIncomingCalls) {
            // Alert mode: Draw more intense, faster waves in red/orange

            // Primary alert wave
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            for (let x = 0; x < width; x++) {
                const y = Math.sin((x + offset) * 0.04) * 35 + height / 2;
                ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(255, 107, 53, 0.9)';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Secondary alert wave
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            for (let x = 0; x < width; x++) {
                const y = Math.sin((x + offset + 50) * 0.03) * 25 + height / 2;
                ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(255, 140, 0, 0.7)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Tertiary alert wave (faster)
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            for (let x = 0; x < width; x++) {
                const y = Math.sin((x + offset * 1.5 + 100) * 0.05) * 15 + height / 2;
                ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(214, 48, 49, 0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Update offset faster for alert mode
            offset += 3;
        } else {
            // Normal mode: Draw calm waves

            // Primary wave
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            for (let x = 0; x < width; x++) {
                const y = Math.sin((x + offset) * 0.02) * 20 + height / 2;
                ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(79, 70, 229, 0.6)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Secondary wave
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            for (let x = 0; x < width; x++) {
                const y = Math.sin((x + offset + 30) * 0.02) * 15 + height / 2;
                ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Update offset normally
            offset += 1;
        }

        // Continue animation if detection is active
        if (appState.isDetecting) {
            requestAnimationFrame(animate);
        }
    }

    // Start animation
    animate();
}

// Load real dashboard data from the API
async function loadDashboardData() {
    try {
        // Fetch data from the API
        const response = await fetch('/api/dashboard');
        const data = await response.json();

        console.log('Fetched dashboard data:', data);

        // Process the scams data - use recentScams from API response (data is already properly formatted)
        const processedScams = (data.recentScams || []).map(call => {
            // The API already returns properly formatted data, just ensure timestamp is a Date object
            const scam = {
                ...call,
                timestamp: new Date(call.timestamp),
                // Ensure we have redacted phone numbers for privacy
                redactedOriginalCaller: call.redactedOriginalCaller || redactPhoneNumber(call.originalCaller || call.phoneNumber),
                redactedPhoneNumber: call.redactedPhoneNumber || (call.phoneNumber ? redactPhoneNumber(call.phoneNumber) : null)
            };
            return scam;
        });

        // Use only real API data - no additional mock data
        const allScams = processedScams;

        // Update app state
        appState.recentScams = allScams;
        appState.scamCounter = data.stats?.scamsDetectedThisWeek || allScams.length;

        // Update UI
        updateScamCounter();
        updateActiveCallsCounter();
        renderRecentScams();
    } catch (error) {
        console.error('Error fetching dashboard data:', error);

        // Show empty state when API fails - no fallback mock data
        appState.recentScams = [];
        appState.scamCounter = 0;

        // Update UI to show empty state
        updateScamCounter();
        updateActiveCallsCounter();
        renderRecentScams();

        // Show error message to user
        const container = document.getElementById('scam-calls-container');
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Unable to load data</h3>
                    <p>Failed to fetch real-time scam detection data. Please check your connection and try again.</p>
                </div>
            `;
        }
    }
}

// Generate random waveform data for visualization (fallback)
function generateRandomWaveform() {
    const waveform = [];
    const length = 40; // Number of data points

    for (let i = 0; i < length; i++) {
        // Generate random amplitude between 0.1 and 1.0
        const amplitude = 0.1 + Math.random() * 0.9;
        waveform.push(amplitude);
    }

    return waveform;
}

// Generate waveform data from audio file
async function generateWaveformFromAudio(audioUrl) {
    try {
        console.log('Attempting to generate waveform from audio URL:', audioUrl);

        // Create audio context
        const AudioContextClass = window.AudioContext || window.webkitAudioContext || null;
        if (!AudioContextClass) {
            throw new Error('Web Audio API not supported');
        }
        const audioContext = new AudioContextClass();

        // Try to fetch the audio file with CORS handling
        let response;
        try {
            // First try with no-cors mode for external URLs
            response = await fetch(audioUrl, {
                mode: 'cors',
                headers: {
                    'Accept': 'audio/*'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (fetchError) {
            console.log('CORS fetch failed, trying alternative approach:', fetchError.message);

            // If CORS fails, try using an Audio element to load the file
            // This won't give us waveform data but will verify the audio is accessible
            const testAudio = new Audio();
            testAudio.crossOrigin = 'anonymous';

            return new Promise((resolve, reject) => {
                testAudio.onloadedmetadata = () => {
                    console.log('Audio loaded successfully, generating synthetic waveform based on duration:', testAudio.duration);
                    // Generate a synthetic waveform based on audio duration
                    const waveform = generateSyntheticWaveform(testAudio.duration);
                    resolve(waveform);
                };

                testAudio.onerror = () => {
                    console.log('Audio loading failed, using random waveform');
                    reject(new Error('Audio loading failed'));
                };

                testAudio.src = audioUrl;
            });
        }

        const arrayBuffer = await response.arrayBuffer();
        console.log('Audio data fetched, size:', arrayBuffer.byteLength, 'bytes');

        // Decode the audio data
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log('Audio decoded successfully, duration:', audioBuffer.duration, 'seconds');

        // Get the audio data
        const channelData = audioBuffer.getChannelData(0);

        // We need to reduce the data points to a manageable number
        const sampleSize = Math.floor(channelData.length / 40);
        const waveform = [];

        // Calculate the peak amplitude for each sample
        for (let i = 0; i < 40; i++) {
            const startIndex = i * sampleSize;
            const endIndex = Math.min(startIndex + sampleSize, channelData.length);
            let maxAmplitude = 0;

            // Find the peak amplitude in this sample
            for (let j = startIndex; j < endIndex; j++) {
                const amplitude = Math.abs(channelData[j]);
                if (amplitude > maxAmplitude) {
                    maxAmplitude = amplitude;
                }
            }

            // Normalize amplitude to 0.1-1.0 range
            const normalizedAmplitude = 0.1 + (maxAmplitude * 0.9);
            waveform.push(normalizedAmplitude);
        }

        console.log('Waveform generated successfully with', waveform.length, 'data points');
        return waveform;
    } catch (error) {
        console.error('Error generating waveform from audio:', error);
        throw error; // Re-throw to let caller handle fallback
    }
}

// Generate synthetic waveform based on audio duration
function generateSyntheticWaveform(duration) {
    const waveform = [];
    const points = 40;

    // Create a more realistic waveform pattern based on typical speech
    for (let i = 0; i < points; i++) {
        const progress = i / points;

        // Create a pattern that simulates speech with varying amplitudes
        let amplitude = 0.3; // Base amplitude

        // Add some variation based on position (speech tends to be louder in middle)
        amplitude += Math.sin(progress * Math.PI) * 0.3;

        // Add some randomness for natural variation
        amplitude += (Math.random() - 0.5) * 0.4;

        // Add some periodic variation to simulate speech patterns
        amplitude += Math.sin(progress * Math.PI * 8) * 0.1;

        // Ensure amplitude is within valid range
        amplitude = Math.max(0.1, Math.min(1.0, amplitude));

        waveform.push(amplitude);
    }

    console.log('Generated synthetic waveform with', waveform.length, 'data points for', duration, 'second audio');
    return waveform;
}

// Update scam counter in UI
function updateScamCounter() {
    const counter = document.getElementById('scam-counter');
    if (counter) {
        counter.textContent = appState.scamCounter;
    }
}

// Update active calls counter in UI
function updateActiveCallsCounter() {
    const counter = document.getElementById('call-counter');
    const activeCallsCard = document.getElementById('active-calls');
    const activeCallsIcon = document.getElementById('active-calls-icon');

    // Calculate active calls count dynamically from live calls
    const activeCallsCount = appState.liveCalls.size;
    console.log('Updating active calls counter to:', activeCallsCount);

    if (counter) {
        counter.textContent = activeCallsCount;
        console.log('Counter element updated to:', counter.textContent);
    } else {
        console.warn('Call counter element not found');
    }

    // Add visual indicators when there are active calls
    if (activeCallsCard && activeCallsIcon) {
        // Check for incoming calls
        const hasIncomingCalls = Array.from(appState.liveCalls.values()).some(call =>
            call.status === 'ringing' || call.status === 'incoming'
        );

        if (hasIncomingCalls) {
            activeCallsCard.classList.add('has-incoming-calls');
            activeCallsCard.classList.remove('has-active-calls');
        } else if (activeCallsCount > 0) {
            activeCallsCard.classList.add('has-active-calls');
            activeCallsCard.classList.remove('has-incoming-calls');
        } else {
            activeCallsCard.classList.remove('has-active-calls', 'has-incoming-calls');
        }
    }
}

// Update live calls display
function updateLiveCallsDisplay() {
    const container = document.getElementById('live-calls-container');
    if (!container) return;

    // Filter out ringing/incoming/recording/processing calls from the Active Calls container
    // These should only be shown in the Live Detection area and notifications
    const allCalls = Array.from(appState.liveCalls.values());
    console.log('🔍 All live calls before filtering:', allCalls.map(c => ({ id: c.id, status: c.status, type: c.type })));

    const activeCalls = allCalls.filter(call => {
        // Log any calls with processing/recording status that shouldn't be here
        if (call.status === 'processing' || call.status === 'recording') {
            console.warn(`⚠️ Found ${call.status} call in liveCalls map that should have been removed: ${call.id}`);
            // Remove it now as a safeguard
            appState.liveCalls.delete(call.id);
            return false;
        }

        return call.status !== 'ringing' && call.status !== 'incoming';
    });

    console.log('✅ Active calls after filtering (should exclude recording/processing):', activeCalls.map(c => ({ id: c.id, status: c.status, type: c.type })));

    // Show/hide container based on active calls (excluding ringing/incoming)
    if (activeCalls.length > 0) {
        container.style.display = 'block';
        container.innerHTML = '';

        // Create live call items only for non-ringing calls
        activeCalls.forEach(call => {
            const callElement = createLiveCallElement(call);
            container.appendChild(callElement);
        });
    } else {
        container.style.display = 'none';
    }

    // Update the active calls counter to reflect incoming call styling
    updateActiveCallsCounter();

    // Manage detection panel alert state
    const hasIncomingCalls = Array.from(appState.liveCalls.values()).some(call =>
        call.status === 'ringing' || call.status === 'incoming'
    );

    if (!hasIncomingCalls) {
        clearIncomingCallAlert();
    }
}

// Create live call element
function createLiveCallElement(call) {
    const template = document.getElementById('live-call-template');
    if (!template) return document.createElement('div');

    const element = document.importNode(template.content, true).querySelector('.live-call-item');

    // Add status class for styling
    element.classList.add(call.status);

    // Set status indicator and text
    const statusText = element.querySelector('.status-text');
    if (statusText) {
        statusText.textContent = getStatusDisplayText(call.status);
    }

    // Set call type with enhanced information
    const callType = element.querySelector('.call-type');
    if (callType) {
        if (call.type === 'incoming_call') {
            if (call.status === 'scam_detected') {
                callType.textContent = `${call.scamType || 'Scam'} Detected - ${call.company || 'Unknown'}`;
            } else if (call.status === 'initiating_callback') {
                callType.textContent = `Initiating ${call.company || 'Unknown'} Agent`;
            } else if (call.status === 'callback_failed') {
                callType.textContent = `Callback Failed - ${call.company || 'Unknown'}`;
            } else {
                callType.textContent = 'Incoming Call';
            }
        } else if (call.type === 'vapi_agent') {
            callType.textContent = `${call.agentName || 'Agent'} (${call.company})`;
        } else {
            callType.textContent = 'Unknown Call';
        }
    }

    // Set caller info with redaction for privacy
    const callerInfo = element.querySelector('.caller-info');
    if (callerInfo) {
        const phoneNumber = call.phoneNumber || 'Unknown';
        // Use consistent redaction function
        callerInfo.textContent = redactPhoneNumber(phoneNumber);
    }

    // Set duration
    const durationElement = element.querySelector('.call-duration');
    if (durationElement) {
        const duration = Math.floor((new Date() - new Date(call.startTime)) / 1000);
        durationElement.textContent = formatDuration(duration);

        // Start timer for this call
        startCallDurationTimer(call.id, durationElement);
    }

    // Add progress animation for certain statuses
    const progressBar = element.querySelector('.progress-fill');
    const stageText = element.querySelector('.stage-text');

    if (progressBar) {
        switch (call.status) {
            case 'recording':
                progressBar.style.animation = 'pulse 2s infinite';
                progressBar.style.backgroundColor = '#ff6b6b';
                progressBar.style.width = '60%';
                if (stageText) stageText.textContent = 'Recording voicemail';
                break;
            case 'processing':
                progressBar.style.animation = 'progress-loading 3s infinite';
                progressBar.style.backgroundColor = '#4ecdc4';
                progressBar.style.width = '80%';
                if (stageText) stageText.textContent = 'Analyzing for scams';
                break;
            case 'scam_detected':
                progressBar.style.animation = 'alert-pulse 1s infinite';
                progressBar.style.backgroundColor = '#ff4757';
                progressBar.style.width = '90%';
                if (stageText) stageText.textContent = 'Scam confirmed!';
                break;
            case 'initiating_callback':
                progressBar.style.animation = 'progress-loading 2s infinite';
                progressBar.style.backgroundColor = '#ffa502';
                progressBar.style.width = '95%';
                if (stageText) stageText.textContent = 'Calling back scammer';
                break;
            case 'callback_failed':
                progressBar.style.animation = 'error-flash 2s infinite';
                progressBar.style.backgroundColor = '#ff3838';
                progressBar.style.width = '100%';
                if (stageText) stageText.textContent = 'Callback failed';
                break;
            case 'in-progress':
                progressBar.style.animation = 'none';
                progressBar.style.backgroundColor = '#2ed573';
                progressBar.style.width = '100%';
                if (stageText) stageText.textContent = 'Agent conversation';
                break;
            case 'ringing':
                progressBar.style.animation = 'pulse 1.5s infinite';
                progressBar.style.backgroundColor = '#ffa502';
                progressBar.style.width = '20%';
                if (stageText) stageText.textContent = ''; // Remove redundant text
                break;
            default:
                progressBar.style.animation = 'none';
                progressBar.style.backgroundColor = '#ddd';
                progressBar.style.width = '30%';
                if (stageText) stageText.textContent = 'Processing';
        }
    }

    return element;
}

// Get status display text
function getStatusDisplayText(status) {
    switch (status) {
        case 'ringing': return 'Ringing';
        case 'recording': return 'Recording';
        case 'processing': return 'Processing';
        case 'scam_detected': return 'Scam Detected';
        case 'initiating_callback': return 'Initiating Callback';
        case 'callback_failed': return 'Callback Failed';
        case 'in-progress': return 'In Progress';
        case 'queued': return 'Queued';
        default: return status.charAt(0).toUpperCase() + status.slice(1);
    }
}

// Format duration in MM:SS format
function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Start call duration timer
function startCallDurationTimer(callId, element) {
    // Clear existing timer if any
    if (appState.callDurationTimers.has(callId)) {
        clearInterval(appState.callDurationTimers.get(callId));
    }

    const timer = setInterval(() => {
        const call = appState.liveCalls.get(callId);
        if (!call) {
            clearInterval(timer);
            appState.callDurationTimers.delete(callId);
            return;
        }

        const duration = Math.floor((new Date() - new Date(call.startTime)) / 1000);
        element.textContent = formatDuration(duration);
    }, 1000);

    appState.callDurationTimers.set(callId, timer);
}

// Redact phone number for privacy (consistent format: 15551XXXX89)
function redactPhoneNumber(phoneNumber) {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
        return phoneNumber;
    }

    // Check if the phone number is already redacted (contains X characters)
    if (phoneNumber.includes('X')) {
        console.log('📱 Phone number already redacted:', phoneNumber);
        return phoneNumber; // Already redacted, return as-is
    }

    // Remove all non-digit characters to get clean number
    const digitsOnly = phoneNumber.replace(/\D/g, '');

    if (digitsOnly.length < 6) {
        return phoneNumber; // Too short to redact meaningfully
    }

    if (digitsOnly.length === 10) {
        // US number without country code: XXX-XXX-XXXX -> 1555XXXX89
        return `1${digitsOnly.substring(0, 3)}XXXX${digitsOnly.substring(8)}`;
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
        // US number with country code: 1XXXXXXXXXX -> 1555XXXX89
        return `${digitsOnly.substring(0, 4)}XXXX${digitsOnly.substring(9)}`;
    } else {
        // International or other format: show first 4 and last 2 digits
        const firstPart = digitsOnly.substring(0, Math.min(4, digitsOnly.length - 2));
        const lastPart = digitsOnly.substring(digitsOnly.length - 2);
        const maskedLength = Math.max(0, digitsOnly.length - 6);
        const masked = 'X'.repeat(maskedLength);
        return `${firstPart}${masked}${lastPart}`;
    }
}

// Show call notification
function showCallNotification(title, message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `call-notification ${type}`;
    notification.innerHTML = `
        <div class="notification-icon">
            <i class="fas fa-${getNotificationIcon(type)}"></i>
        </div>
        <div class="notification-content">
            <div class="notification-title">${title}</div>
            <div class="notification-message">${message}</div>
        </div>
    `;

    // Add to page
    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);

    // Remove after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// Get notification icon based on type
function getNotificationIcon(type) {
    switch (type) {
        case 'incoming': return 'phone-alt';
        case 'recording': return 'microphone';
        case 'processing': return 'cog';
        case 'scam_detected': return 'exclamation-triangle';
        case 'initiating_callback': return 'phone-volume';
        case 'callback_failed': return 'times-circle';
        case 'in-progress': return 'phone';
        case 'queued': return 'clock';
        case 'completed': return 'check-circle';
        case 'failed': return 'times-circle';
        case 'success': return 'check-circle';
        default: return 'bell';
    }
}

// Render recent scams in the UI
async function renderRecentScams() {
    const container = document.getElementById('scam-calls-container');
    if (!container) return;

    // Clear container
    container.innerHTML = '';

    // Check if we have any scams to display
    if (!appState.recentScams || appState.recentScams.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-shield-alt"></i>
                <h3>No scam calls detected yet</h3>
                <p>The system is actively monitoring for scam calls. When a scam is detected, it will appear here along with the VAPI agent response.</p>
                <div class="empty-state-actions">
                    <button class="btn btn-primary" onclick="loadDashboardData()">
                        <i class="fas fa-refresh"></i> Refresh Data
                    </button>
                </div>
            </div>
        `;
        return;
    }

    // Get template
    const template = document.getElementById('scam-call-template');
    if (!template) return;

    // Create audio element for playback
    if (!appState.audioPlayer) {
        appState.audioPlayer = new Audio();
        appState.currentlyPlaying = null;
    }

    // Process each scam
    for (const scam of appState.recentScams) {
        const scamElement = document.importNode(template.content, true).querySelector('.scam-call-item');

        // Set data attributes
        scamElement.dataset.scamId = scam.id;
        scamElement.dataset.scamType = scam.scamType;
        scamElement.dataset.type = scam.type || 'scam_voicemail'; // Add type for filtering
        scamElement.dataset.source = scam.source || 'twilio';

        // Add visual styling based on type
        if (scam.type === 'agent_conversation') {
            scamElement.classList.add('agent-conversation');
        } else {
            scamElement.classList.add('scam-voicemail');
        }

        // Add company-specific styling class
        const companyClass = getCompanyClass(scam);
        if (companyClass) {
            scamElement.classList.add(companyClass);
        }

        // Set company tags (multiple clickable tags)
        const companyTag = scamElement.querySelector('.company-tag');
        if (companyTag) {
            // Clear existing content
            companyTag.innerHTML = '';

            // Create tags from the tags array or fallback to single tag
            const tags = scam.tags || [scam.agentName || scam.company || 'Unknown'];

            tags.forEach((tag) => {
                // Skip null/undefined tags
                if (!tag || typeof tag !== 'string') {
                    return;
                }

                const tagElement = document.createElement('span');
                tagElement.className = 'tag-item';
                tagElement.textContent = tag;
                tagElement.dataset.filter = tag.toLowerCase().replace(/\s+/g, '_');

                // Make tags clickable for filtering
                tagElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    filterByTag(tag);
                });

                // Set CSS class based on tag type for better styling
                const tagLower = tag.toLowerCase();
                let tagClass = 'default';

                if (scam.type === 'agent_conversation') {
                    tagClass = 'agent-conversation';
                } else if (tagLower.includes('kraken')) {
                    tagClass = 'kraken';
                } else if (tagLower.includes('coinbase')) {
                    tagClass = 'coinbase';
                } else if (tagLower.includes('binance')) {
                    tagClass = 'binance';
                } else if (tagLower.includes('crypto') || tagLower.includes('exchange')) {
                    tagClass = 'crypto-other';
                } else if (tagLower.includes('it') || tagLower.includes('microsoft') || tagLower.includes('apple') || tagLower.includes('support')) {
                    tagClass = 'it-support';
                } else if (tagLower.includes('bank') || tagLower.includes('chase') || tagLower.includes('wells') || tagLower.includes('bofa')) {
                    tagClass = 'banking';
                }

                tagElement.classList.add(tagClass);
                companyTag.appendChild(tagElement);
            });
        }

        // Set scam type tag
        const scamTypeTag = scamElement.querySelector('.scam-type-tag');
        if (scamTypeTag) {
            let scamTypeText = 'Unknown';

            if (scam.type === 'agent_conversation') {
                scamTypeText = 'Agent Call';
                scamTypeTag.style.backgroundColor = 'var(--secondary-color)';
                scamTypeTag.style.color = 'white';

                // Add duration and success info for agent calls
                if (scam.duration) {
                    const minutes = Math.floor(scam.duration / 60);
                    const seconds = Math.floor(scam.duration % 60);
                    scamTypeText += ` (${minutes}:${seconds.toString().padStart(2, '0')})`;
                }

                if (scam.successful) {
                    scamTypeText += ' ✓';
                }
            } else if (scam.scamType === 'crypto_exchange') {
                scamTypeText = 'Crypto Exchange';
            } else if (scam.scamType === 'it_support') {
                scamTypeText = 'IT Support';
            } else if (scam.scamType === 'banking') {
                scamTypeText = 'Banking';
            } else if (scam.type === 'scam_voicemail') {
                scamTypeText = 'Scam Voicemail';
            }

            scamTypeTag.textContent = scamTypeText;
        }

        // Set call time
        const callTime = scamElement.querySelector('.call-time');
        if (callTime) {
            callTime.textContent = moment(scam.timestamp).fromNow();
        }

        // Set phone number information
        const originalCallerDiv = scamElement.querySelector('.original-caller');
        const callbackNumberDiv = scamElement.querySelector('.callback-number');
        const callerNumberSpan = scamElement.querySelector('.caller-number');
        const callbackNumberSpan = scamElement.querySelector('.callback-number-text');

        // Show original caller number (who called our Twilio number)
        if (scam.redactedOriginalCaller && originalCallerDiv && callerNumberSpan) {
            callerNumberSpan.textContent = scam.redactedOriginalCaller;
            originalCallerDiv.style.display = 'flex';
        }

        // Show callback number (extracted from scam message or VAPI call target)
        if (scam.redactedPhoneNumber && callbackNumberDiv && callbackNumberSpan) {
            callbackNumberSpan.textContent = scam.redactedPhoneNumber;
            callbackNumberDiv.style.display = 'flex';
        } else if (scam.redactedCallbackNumber && callbackNumberDiv && callbackNumberSpan) {
            callbackNumberSpan.textContent = scam.redactedCallbackNumber;
            callbackNumberDiv.style.display = 'flex';
        }

        // Set call message/transcript and populate separate sections
        const callMessage = scamElement.querySelector('.call-message');
        const summarySection = scamElement.querySelector('.summary-section');
        const successSection = scamElement.querySelector('.success-section');

        if (callMessage) {
            // Show the full transcript if available (for both agent conversations and scam voicemails)
            if (scam.transcript) {
                // Use the pre-formatted transcript from the API (already has beautiful styling)
                callMessage.innerHTML = scam.transcript;

                // Populate separate analysis sections for agent conversations
                if (scam.type === 'agent_conversation') {
                    populateAnalysisSections(scamElement, scam.analysis);
                }
            } else {
                // Fallback to the truncated message
                callMessage.innerHTML = scam.message;
            }

            // If there's a transcript URL, fetch it
            if (scam.transcriptUrl) {
                fetch(scam.transcriptUrl)
                    .then(response => {
                        if (response.ok) return response.text();
                        throw new Error('Failed to fetch transcript');
                    })
                    .then(transcript => {
                        // Format the transcript for better display (without analysis)
                        // For transcript URLs, this is typically a voicemail
                        const transcriptType = scam.type || 'scam_voicemail';
                        const formattedTranscript = formatTranscriptForDisplay(transcript, transcriptType);
                        callMessage.innerHTML = formattedTranscript;
                    })
                    .catch(error => {
                        console.error('Error fetching transcript:', error);
                    });
            }
        }

        // Set confidence meter
        const confidenceFill = scamElement.querySelector('.confidence-fill');
        const confidenceValue = scamElement.querySelector('.confidence-value');
        if (confidenceFill && confidenceValue) {
            confidenceFill.style.width = `${scam.confidence}%`;
            confidenceValue.textContent = `${scam.confidence}%`;

            // Set color based on confidence
            if (scam.confidence >= 90) {
                confidenceFill.style.backgroundColor = 'var(--danger-color)';
            } else if (scam.confidence >= 70) {
                confidenceFill.style.backgroundColor = 'var(--warning-color)';
            }
        }

        // Add to container first so canvas has proper dimensions
        container.appendChild(scamElement);

        // Draw waveform after element is in DOM
        const waveformCanvas = scamElement.querySelector('.waveform-canvas');
        if (waveformCanvas) {
            // Ensure canvas has dimensions before drawing
            setTimeout(() => {
                // Generate waveform from audio if available, otherwise use random
                if (!scam.waveform && scam.audioUrl) {
                    console.log('Generating waveform for scam', scam.id, 'from audio URL:', scam.audioUrl);
                    // Try to generate from real audio first
                    generateWaveformFromAudio(scam.audioUrl)
                        .then(realWaveform => {
                            console.log('Successfully generated waveform for scam', scam.id, 'with', realWaveform.length, 'data points');
                            scam.waveform = realWaveform;
                            drawWaveform(waveformCanvas, scam.waveform);
                            setupWaveformInteraction(waveformCanvas, scam);
                        })
                        .catch(error => {
                            console.log('Could not generate waveform from audio for scam', scam.id, ':', error.message);
                            // Generate a fallback random waveform so interaction still works
                            console.log('Generating fallback random waveform for scam', scam.id);
                            scam.waveform = generateRandomWaveform();
                            drawWaveform(waveformCanvas, scam.waveform);
                            // Don't set up interaction for failed audio - just visual waveform
                            console.log('Audio unavailable - waveform is visual only');
                        });
                } else if (!scam.waveform) {
                    console.log('No audio URL for scam', scam.id, ', generating random waveform');
                    scam.waveform = generateRandomWaveform();
                    drawWaveform(waveformCanvas, scam.waveform);
                    setupWaveformInteraction(waveformCanvas, scam);
                } else {
                    console.log('Using existing waveform for scam', scam.id, 'with', scam.waveform.length, 'data points');
                    drawWaveform(waveformCanvas, scam.waveform);
                    setupWaveformInteraction(waveformCanvas, scam);
                }

                // Set up timestamps
                const timestampStart = scamElement.querySelector('.timestamp-start');
                const timestampEnd = scamElement.querySelector('.timestamp-end');
                if (timestampStart && timestampEnd) {
                    timestampStart.textContent = '0:00';

                    if (scam.audioUrl) {
                        // Try to get real duration from audio
                        const tempAudio = new Audio(scam.audioUrl);
                        tempAudio.addEventListener('loadedmetadata', () => {
                            timestampEnd.textContent = formatTime(tempAudio.duration);
                        });
                        tempAudio.addEventListener('error', () => {
                            timestampEnd.textContent = '2:34'; // Fallback duration
                        });
                        tempAudio.load();
                    } else {
                        timestampEnd.textContent = '0:00'; // No audio available
                    }
                }

            }, 10); // Small delay to ensure DOM is ready
        }

        // Add play button event listener
        const playButton = scamElement.querySelector('.play-btn');
        if (playButton) {
            // Store audio URL in the button's data attribute
            if (scam.audioUrl) {
                playButton.dataset.audioUrl = scam.audioUrl;

                // Test if audio is actually available by making a HEAD request
                fetch(scam.audioUrl, { method: 'HEAD' })
                    .then(response => {
                        if (!response.ok) {
                            // Audio not available, disable play button
                            playButton.disabled = true;
                            playButton.style.opacity = '0.5';
                            playButton.title = 'Audio not available (recording may have expired)';
                            console.log('Audio not available for scam', scam.id, '- status:', response.status);
                        }
                    })
                    .catch(error => {
                        // Audio not available, disable play button
                        playButton.disabled = true;
                        playButton.style.opacity = '0.5';
                        playButton.title = 'Audio not available';
                        console.log('Audio check failed for scam', scam.id, ':', error.message);
                    });
            } else {
                // No audio URL, disable play button
                playButton.disabled = true;
                playButton.style.opacity = '0.5';
                playButton.title = 'No audio available';
            }

            playButton.addEventListener('click', () => {
                const audioUrl = playButton.dataset.audioUrl;
                const icon = playButton.querySelector('i');
                const waveformCanvas = scamElement.querySelector('.waveform-canvas');

                // If we have a real audio URL and button is not disabled
                if (audioUrl && !playButton.disabled) {
                    // If this is the currently playing audio
                    if (appState.currentlyPlaying === scam.id) {
                        // Pause the audio
                        if (!appState.audioPlayer.paused) {
                            appState.audioPlayer.pause();
                            icon.classList.remove('fa-pause');
                            icon.classList.add('fa-play');
                        } else {
                            // Resume playback
                            appState.audioPlayer.play();
                            icon.classList.remove('fa-play');
                            icon.classList.add('fa-pause');
                        }
                    } else {
                        // Reset all other play buttons
                        document.querySelectorAll('.play-btn i').forEach(i => {
                            i.classList.remove('fa-pause');
                            i.classList.add('fa-play');
                        });

                        // Start playing this audio - only set src if it's different
                        if (appState.audioPlayer.src !== audioUrl) {
                            appState.audioPlayer.src = audioUrl;
                        }
                        appState.audioPlayer.play();
                        appState.currentlyPlaying = scam.id;

                        // Update icon
                        icon.classList.remove('fa-play');
                        icon.classList.add('fa-pause');

                        // Set up waveform visualization for playback
                        if (waveformCanvas && scam.waveform) {
                            setupWaveformPlayback(scam.id, appState.audioPlayer, waveformCanvas, scam.waveform);

                            // Update timestamp during playback
                            const timestampStart = scamElement.querySelector('.timestamp-start');
                            if (timestampStart) {
                                // Update current time during playback
                                appState.audioPlayer.addEventListener('timeupdate', () => {
                                    if (appState.currentlyPlaying === scam.id) {
                                        timestampStart.textContent = formatTime(appState.audioPlayer.currentTime);
                                    }
                                });

                                // Reset timestamp when playback ends
                                appState.audioPlayer.addEventListener('ended', () => {
                                    timestampStart.textContent = '0:00';
                                });
                            }
                        }

                        // When audio ends, reset the button
                        appState.audioPlayer.onended = () => {
                            icon.classList.remove('fa-pause');
                            icon.classList.add('fa-play');
                            appState.currentlyPlaying = null;
                        };
                    }
                } else {
                    // No audio available - disable play button
                    playButton.disabled = true;
                    playButton.style.opacity = '0.5';
                    playButton.title = 'No audio available';
                }
            });
        }
    }

    // Apply current filter
    filterScamCalls(appState.currentFilter);
}

// Draw waveform on canvas with SoundCloud-like styling
function drawWaveform(canvas, waveformData, playbackPosition = -1, hoverPosition = -1) {
    if (!canvas || !waveformData || waveformData.length === 0) {
        console.log('drawWaveform: Missing canvas or waveform data', { canvas: !!canvas, waveformData: waveformData?.length });
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.log('drawWaveform: Could not get canvas context');
        return;
    }

    // Set canvas dimensions with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
        console.log('drawWaveform: Canvas has zero dimensions', rect);
        return;
    }

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Calculate bar width based on number of data points
    const barWidth = rect.width / waveformData.length;
    const barSpacing = Math.max(1, barWidth * 0.1); // 10% spacing
    const effectiveBarWidth = Math.max(2, barWidth - barSpacing);

    // Draw each bar with improved styling
    waveformData.forEach((amplitude, index) => {
        const barHeight = Math.max(2, amplitude * rect.height * 0.8); // Minimum height of 2px
        const x = index * barWidth;
        const y = (rect.height - barHeight) / 2;

        // Determine color based on state
        let fillStyle;
        if (playbackPosition >= 0) {
            if (index <= playbackPosition) {
                // Played portion - orange/red gradient
                fillStyle = '#FF5500';
            } else if (hoverPosition >= 0 && index <= hoverPosition) {
                // Hover preview - lighter orange
                fillStyle = '#FF8833';
            } else {
                // Unplayed portion - gray
                fillStyle = '#CCCCCC';
            }
        } else {
            // Default state - SoundCloud orange
            if (hoverPosition >= 0 && index <= hoverPosition) {
                fillStyle = '#FF8833';
            } else {
                fillStyle = '#FF5500';
            }
        }

        ctx.fillStyle = fillStyle;

        // Add rounded corners for better appearance
        if (effectiveBarWidth >= 4 && ctx.roundRect) {
            const radius = Math.min(effectiveBarWidth / 2, 2);
            ctx.beginPath();
            ctx.roundRect(x, y, effectiveBarWidth, barHeight, radius);
            ctx.fill();
        } else {
            ctx.fillRect(x, y, effectiveBarWidth, barHeight);
        }
    });

    // Draw progress indicator line if playing
    if (playbackPosition >= 0) {
        const progressX = (playbackPosition / waveformData.length) * rect.width;
        ctx.strokeStyle = '#FF5500';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(progressX, 0);
        ctx.lineTo(progressX, rect.height);
        ctx.stroke();
    }
}

// Format transcript for better display (without analysis)
function formatTranscriptForDisplay(transcript, transcriptType = 'scam_voicemail') {
    if (!transcript) return 'No transcript available';

    console.log('Raw transcript:', transcript); // Debug log
    console.log('Transcript type:', transcriptType); // Debug log

    // Clean up the transcript but be more conservative about removing content
    let formatted = transcript.trim();

    // Remove the header if it exists (added by backend formatting)
    formatted = formatted.replace(/^=== VOICEMAIL TRANSCRIPT ===[\s\S]*?\n\n/, '');

    // For voicemails, treat the entire content as coming from the caller
    if (transcriptType === 'scam_voicemail') {
        // Remove any existing speaker labels that might have been added
        formatted = formatted.replace(/^(AI|Agent|User|Caller):\s*/gmi, '');

        // Split into sentences or natural breaks, but preserve all content
        const sentences = formatted.split(/(?<=[.!?])\s+/).filter(s => s.trim());

        if (sentences.length > 0) {
            // Group sentences into logical chunks (every 2-3 sentences)
            const chunks = [];
            for (let i = 0; i < sentences.length; i += 2) {
                const chunk = sentences.slice(i, i + 2).join(' ').trim();
                if (chunk) {
                    chunks.push(`<strong class="speaker-user">Caller:</strong> ${chunk}`);
                }
            }
            formatted = chunks.join('<br>');
        } else {
            // If no sentences found, treat as single block
            formatted = `<strong class="speaker-user">Caller:</strong> ${formatted}`;
        }
    } else {
        // For agent conversations, use the existing speaker detection logic
        const lines = formatted.split(/\r?\n/).filter(line => line.trim());
        const processedLines = [];

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            // Only skip lines that are clearly just names (very short and all letters)
            if (/^[A-Za-z\s]+$/.test(line) && line.length < 20) {
                continue;
            }

            if (line.match(/^(AI|Agent):/i)) {
                line = line.replace(/^(AI|Agent):\s*/i, '');
                processedLines.push(`<strong class="speaker-ai">Agent:</strong> ${line}`);
            } else if (line.match(/^(User|Caller):/i)) {
                line = line.replace(/^(User|Caller):\s*/i, '');
                processedLines.push(`<strong class="speaker-user">Caller:</strong> ${line}`);
            } else {
                // Determine speaker based on content for agent conversations
                if (line.match(/^(Hello|Hi|Hey|Thank you|Please|All of our calls|To Coinbase)/i)) {
                    processedLines.push(`<strong class="speaker-ai">Agent:</strong> ${line}`);
                } else {
                    processedLines.push(`<strong class="speaker-user">Caller:</strong> ${line}`);
                }
            }
        }

        formatted = processedLines.join('<br>');
    }

    // If no content after processing, add default
    if (!formatted.trim()) {
        if (transcriptType === 'scam_voicemail') {
            formatted = '<strong class="speaker-user">Caller:</strong> No transcript available';
        } else {
            formatted = '<strong class="speaker-ai">Agent:</strong> No transcript available';
        }
    }

    console.log('Formatted transcript length:', formatted.length); // Debug log
    console.log('Formatted transcript preview:', formatted.substring(0, 200) + '...'); // Debug log

    // Return just the transcript content without analysis
    return `<div class="transcript-content">
        <div class="transcript-body">
            ${formatted}
        </div>
    </div>`;
}

// Populate separate analysis sections
function populateAnalysisSections(scamElement, analysis) {
    if (!analysis) return;

    const summarySection = scamElement.querySelector('.summary-section');
    const successSection = scamElement.querySelector('.success-section');

    // Populate summary section
    if (analysis.summary && summarySection) {
        const summaryContent = summarySection.querySelector('.summary-content');
        if (summaryContent) {
            summaryContent.textContent = analysis.summary;
            summarySection.style.display = 'block';
        }
    }

    // Populate success evaluation section
    if (analysis.successEvaluation && successSection) {
        const successContent = successSection.querySelector('.success-content');
        if (successContent) {
            const isSuccess = analysis.successEvaluation.toLowerCase().includes('success') ||
                            analysis.successEvaluation.toLowerCase().includes('yes');
            const successClass = isSuccess ? 'success' : 'failure';

            successContent.innerHTML = `
                <div class="success-evaluation ${successClass}">
                    <i class="fas fa-${isSuccess ? 'check-circle' : 'times-circle'}"></i>
                    ${analysis.successEvaluation}
                </div>
            `;
            successSection.style.display = 'block';
        }
    }
}

// Format time for display
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Get company-specific CSS class for styling
function getCompanyClass(scam) {
    // Check company name first
    const company = (scam.company || '').toLowerCase();
    const agentName = (scam.agentName || '').toLowerCase();
    const tags = scam.tags || [];

    // Check all relevant fields for company identification
    const searchText = `${company} ${agentName} ${tags.join(' ')}`.toLowerCase();

    if (searchText.includes('coinbase')) {
        return 'company-coinbase';
    } else if (searchText.includes('kraken')) {
        return 'company-kraken';
    } else if (searchText.includes('binance')) {
        return 'company-binance';
    } else if (searchText.includes('crypto') || searchText.includes('exchange')) {
        return 'company-crypto-other';
    } else if (searchText.includes('microsoft') || searchText.includes('apple') ||
               searchText.includes('google') || searchText.includes('it') ||
               searchText.includes('support')) {
        return 'company-it-support';
    } else if (searchText.includes('bank') || searchText.includes('chase') ||
               searchText.includes('wells') || searchText.includes('bofa')) {
        return 'company-banking';
    }

    return null; // No specific company class
}

// Format duration from audio element
function formatDuration(audioElement) {
    if (!audioElement || isNaN(audioElement.duration)) {
        return '0:00';
    }
    return formatTime(audioElement.duration);
}

// Set up waveform interaction (click to seek and hover effects)
function setupWaveformInteraction(waveformCanvas, scam) {
    if (!waveformCanvas) {
        console.log('setupWaveformInteraction: No waveform canvas provided');
        return;
    }

    if (!scam.waveform) {
        console.log('setupWaveformInteraction: No waveform data available for scam', scam.id);
        return;
    }

    if (!scam.audioUrl) {
        console.log('setupWaveformInteraction: No audio URL available for scam', scam.id);
        return;
    }

    console.log('Setting up waveform interaction for scam', scam.id, 'with waveform length', scam.waveform.length);

    // Remove any existing event listeners to prevent duplicates
    if (waveformCanvas._waveformListeners) {
        waveformCanvas.removeEventListener('mousemove', waveformCanvas._waveformListeners.mousemove);
        waveformCanvas.removeEventListener('mouseleave', waveformCanvas._waveformListeners.mouseleave);
        waveformCanvas.removeEventListener('click', waveformCanvas._waveformListeners.click);
    }

    let hoverPosition = -1;

    // Mouse move handler for hover effects
    const handleMouseMove = (event) => {
        const rect = waveformCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const hoverIndex = Math.floor((x / rect.width) * scam.waveform.length);

        if (hoverIndex !== hoverPosition) {
            hoverPosition = hoverIndex;
            const playbackPosition = appState.currentlyPlaying === scam.id ?
                Math.floor((appState.audioPlayer.currentTime / appState.audioPlayer.duration) * scam.waveform.length) : -1;
            drawWaveform(waveformCanvas, scam.waveform, playbackPosition, hoverPosition);
        }
    };

    // Mouse leave handler to clear hover effects
    const handleMouseLeave = () => {
        hoverPosition = -1;
        const playbackPosition = appState.currentlyPlaying === scam.id ?
            Math.floor((appState.audioPlayer.currentTime / appState.audioPlayer.duration) * scam.waveform.length) : -1;
        drawWaveform(waveformCanvas, scam.waveform, playbackPosition);
    };

    // Click handler for seeking
    const handleClick = (event) => {
        // Prevent event bubbling to avoid triggering other click handlers
        event.stopPropagation();
        event.preventDefault();

        console.log('Waveform clicked for scam', scam.id);

        if (!scam.audioUrl || !appState.audioPlayer) {
            console.log('No audio URL or audio player available');
            return;
        }

        const rect = waveformCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const clickPercentage = Math.max(0, Math.min(1, x / rect.width)); // Clamp between 0 and 1

        console.log('Click position:', clickPercentage, 'of waveform width');
        console.log('Current audio state - src:', appState.audioPlayer.src);
        console.log('Current audio state - currentTime:', appState.audioPlayer.currentTime);
        console.log('Current audio state - duration:', appState.audioPlayer.duration);
        console.log('Current audio state - paused:', appState.audioPlayer.paused);
        console.log('Current audio state - readyState:', appState.audioPlayer.readyState);
        console.log('Current audio state - seekable ranges:', appState.audioPlayer.seekable.length > 0 ?
            `${appState.audioPlayer.seekable.start(0)} - ${appState.audioPlayer.seekable.end(0)}` : 'none');
        console.log('Currently playing scam ID:', appState.currentlyPlaying);

        // If this isn't the currently playing audio, start playing it first
        if (appState.currentlyPlaying !== scam.id) {
            console.log('Starting playback for scam', scam.id, 'and seeking to', clickPercentage);

            // Reset all other play buttons
            document.querySelectorAll('.play-btn i').forEach(i => {
                i.classList.remove('fa-pause');
                i.classList.add('fa-play');
            });

            // Set up the audio source - only if it's different
            if (appState.audioPlayer.src !== scam.audioUrl) {
                appState.audioPlayer.src = scam.audioUrl;
            }
            appState.currentlyPlaying = scam.id;

            // Wait for the audio to load enough metadata to know its duration
            const handleLoadedMetadata = () => {
                const seekTime = clickPercentage * appState.audioPlayer.duration;
                console.log('Audio loaded, duration:', appState.audioPlayer.duration, 'seeking to:', seekTime, 'seconds');
                appState.audioPlayer.currentTime = seekTime;

                // Start playing from the seek position
                appState.audioPlayer.play().catch(error => {
                    console.error('Error starting audio playback:', error);
                });

                // Remove the event listener
                appState.audioPlayer.removeEventListener('loadedmetadata', handleLoadedMetadata);
            };

            // If metadata is already loaded, seek immediately
            if (appState.audioPlayer.duration && !isNaN(appState.audioPlayer.duration)) {
                const seekTime = clickPercentage * appState.audioPlayer.duration;
                console.log('Audio metadata already available, seeking to:', seekTime, 'seconds');
                appState.audioPlayer.currentTime = seekTime;
                appState.audioPlayer.play().catch(error => {
                    console.error('Error starting audio playback:', error);
                });
            } else {
                // Wait for metadata to load
                appState.audioPlayer.addEventListener('loadedmetadata', handleLoadedMetadata);
                appState.audioPlayer.load(); // Trigger loading
            }

            // Update play button icon
            const playButton = waveformCanvas.closest('.scam-call-item').querySelector('.play-btn i');
            if (playButton) {
                playButton.classList.remove('fa-play');
                playButton.classList.add('fa-pause');
            }
        } else {
            // If already playing, just seek to the clicked position
            if (appState.audioPlayer.duration && !isNaN(appState.audioPlayer.duration)) {
                const seekTime = clickPercentage * appState.audioPlayer.duration;
                console.log('Already playing, seeking to time:', seekTime, 'seconds');

                // Check if the seek time is within seekable range
                let canSeek = false;
                if (appState.audioPlayer.seekable.length > 0) {
                    const seekableStart = appState.audioPlayer.seekable.start(0);
                    const seekableEnd = appState.audioPlayer.seekable.end(0);
                    canSeek = seekTime >= seekableStart && seekTime <= seekableEnd;
                    console.log('Seekable range:', seekableStart, '-', seekableEnd, 'Can seek to', seekTime, ':', canSeek);
                }

                // Check if the audio is in a seekable state
                if (appState.audioPlayer.readyState >= 2 && canSeek) { // HAVE_CURRENT_DATA or higher
                    try {
                        // Store the playing state
                        const wasPlaying = !appState.audioPlayer.paused;

                        console.log('Setting currentTime from', appState.audioPlayer.currentTime, 'to', seekTime);

                        // Use the seeked event to ensure the seek operation completes
                        const handleSeeked = () => {
                            console.log('Seek completed successfully, currentTime is now:', appState.audioPlayer.currentTime);
                            appState.audioPlayer.removeEventListener('seeked', handleSeeked);

                            // Resume playback if it was playing
                            if (wasPlaying && appState.audioPlayer.paused) {
                                appState.audioPlayer.play().catch(error => {
                                    console.error('Error resuming playback after seek:', error);
                                });
                            }
                        };

                        // Add the seeked event listener
                        appState.audioPlayer.addEventListener('seeked', handleSeeked);

                        // Perform the seek operation
                        appState.audioPlayer.currentTime = seekTime;

                        console.log('Seek operation initiated, waiting for seeked event...');
                    } catch (error) {
                        console.error('Error during seek operation:', error);
                    }
                } else {
                    console.log('Audio not ready for seeking, readyState:', appState.audioPlayer.readyState);
                    // If not ready, wait for it to be ready
                    const handleCanSeek = () => {
                        console.log('Audio ready, attempting delayed seek to:', seekTime);
                        appState.audioPlayer.currentTime = seekTime;
                        appState.audioPlayer.removeEventListener('canplay', handleCanSeek);
                        console.log('Delayed seek completed, new currentTime:', appState.audioPlayer.currentTime);
                    };
                    appState.audioPlayer.addEventListener('canplay', handleCanSeek);
                }
            } else {
                console.log('Cannot seek: audio duration not available');
            }
        }
    };

    // Add event listeners
    waveformCanvas.addEventListener('mousemove', handleMouseMove);
    waveformCanvas.addEventListener('mouseleave', handleMouseLeave);
    waveformCanvas.addEventListener('click', handleClick);

    // Store event listeners for cleanup if needed
    waveformCanvas._waveformListeners = {
        mousemove: handleMouseMove,
        mouseleave: handleMouseLeave,
        click: handleClick
    };

    // Set up waveform playback visualization
    setupWaveformPlayback(scam.id, appState.audioPlayer, waveformCanvas, scam.waveform);

    console.log('Waveform interaction setup complete for scam', scam.id);
}

// Update waveform visualization during audio playback
function setupWaveformPlayback(scamId, audioPlayer, waveformCanvas, waveformData) {
    if (!audioPlayer || !waveformCanvas || !waveformData) return;

    // Store the animation frame ID so we can cancel it later
    let animationFrameId;

    // Function to update the waveform visualization
    const updateWaveform = () => {
        if (appState.currentlyPlaying !== scamId) return;

        // Calculate playback position as a percentage
        const playbackPercentage = audioPlayer.currentTime / audioPlayer.duration;

        // Convert to waveform index
        const playbackPosition = Math.floor(playbackPercentage * waveformData.length);

        // Redraw the waveform with the current playback position
        drawWaveform(waveformCanvas, waveformData, playbackPosition);

        // Continue animation if still playing
        if (!audioPlayer.paused) {
            animationFrameId = requestAnimationFrame(updateWaveform);
        }
    };

    // Start animation when playback begins
    const handlePlay = () => {
        if (appState.currentlyPlaying === scamId) {
            animationFrameId = requestAnimationFrame(updateWaveform);
        }
    };

    // Stop animation when playback pauses or ends
    const handlePause = () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
    };

    const handleEnded = () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        // Reset waveform to default state
        drawWaveform(waveformCanvas, waveformData);
    };

    // Handle seeking - update waveform immediately when user seeks
    const handleSeeked = () => {
        if (appState.currentlyPlaying === scamId) {
            updateWaveform(); // Update immediately after seeking
        }
    };

    // Handle time updates for smooth progress
    const handleTimeUpdate = () => {
        if (appState.currentlyPlaying === scamId && !audioPlayer.paused) {
            // Only update if we're not already animating (to avoid conflicts)
            if (!animationFrameId) {
                updateWaveform();
            }
        }
    };

    // Add event listeners
    audioPlayer.addEventListener('play', handlePlay);
    audioPlayer.addEventListener('pause', handlePause);
    audioPlayer.addEventListener('ended', handleEnded);
    audioPlayer.addEventListener('seeked', handleSeeked);
    audioPlayer.addEventListener('timeupdate', handleTimeUpdate);

    // Store event listeners for cleanup if needed
    if (!audioPlayer._waveformPlaybackListeners) {
        audioPlayer._waveformPlaybackListeners = new Map();
    }

    audioPlayer._waveformPlaybackListeners.set(scamId, {
        play: handlePlay,
        pause: handlePause,
        ended: handleEnded,
        seeked: handleSeeked,
        timeupdate: handleTimeUpdate
    });
}

// Set up periodic updates for real-time data
function setupPeriodicUpdates() {
    console.log('🔄 Setting up periodic updates as fallback for SSE');

    // Show visual indicator that we're in polling mode
    const detectionMessage = document.getElementById('detection-message');
    if (detectionMessage) {
        const isServerless = appState.isServerless;
        const iconClass = isServerless ? 'fas fa-cloud' : 'fas fa-sync-alt fa-spin';
        const iconColor = isServerless ? 'var(--info-color)' : 'var(--warning-color)';
        const message = isServerless ? 'Serverless polling mode - monitoring for scam calls...' : 'Polling mode - monitoring for scam calls...';

        detectionMessage.innerHTML = `
            <i class="${iconClass}" style="color: ${iconColor};"></i>
            <span>${message}</span>
        `;
    }

    // Track last update timestamp for polling
    let lastUpdateTimestamp = new Date().toISOString();

    // Poll for real-time events every 5 seconds
    setInterval(async () => {
        try {
            // Fetch events since last update
            const response = await fetch(`/api/live-updates?mode=poll&since=${encodeURIComponent(lastUpdateTimestamp)}`);
            const data = await response.json();

            if (data.success && data.events) {
                // Process each event
                data.events.forEach(event => {
                    console.log('📨 Processing polled event:', event.type);
                    handleSSEMessage(event);
                });

                // Update timestamp for next poll
                if (data.events.length > 0) {
                    lastUpdateTimestamp = data.timestamp;
                }
            }

            // Update active calls from polling data
            if (data.activeCalls) {
                handleActiveCallsUpdate({ calls: data.activeCalls });
            }
        } catch (error) {
            console.error('Error polling for updates:', error);
        }
    }, 5000); // Poll every 5 seconds

    // Refresh dashboard data every 30 seconds
    setInterval(async () => {
        try {
            // Fetch fresh data from the API
            const response = await fetch('/api/dashboard');
            const data = await response.json();

            // Update scam counter if it has changed
            if (data.stats && typeof data.stats.scamsDetectedThisWeek === 'number' &&
                data.stats.scamsDetectedThisWeek > appState.scamCounter) {

                // If there are new scams, show a detection alert
                const newScamCount = data.stats.scamsDetectedThisWeek - appState.scamCounter;
                appState.scamCounter = data.stats.scamsDetectedThisWeek;
                updateScamCounter();

                if (newScamCount > 0 && data.recentScams && data.recentScams.length > 0) {
                    // Show detection alert for the most recent scam
                    const latestScam = data.recentScams[0];
                    showDetectionAlert({
                        company: latestScam.company,
                        scamType: latestScam.scamType
                    });

                    // Refresh the scam list
                    loadDashboardData();
                }
            }
        } catch (error) {
            console.error('Error refreshing dashboard data:', error);
        }
    }, 30000);

    // Check for active VAPI calls more frequently (both serverless and regular)
    console.log('🔄 Setting up frequent VAPI call checks');
    setInterval(async () => {
        try {
            // Try dashboard endpoint first (includes active calls)
            const dashboardResponse = await fetch('/api/dashboard');
            const dashboardData = await dashboardResponse.json();

            if (dashboardData.success && dashboardData.activeCalls) {
                console.log('📊 Dashboard active calls:', dashboardData.activeCalls.length);

                // Clear old VAPI calls and add current ones
                const existingCallIds = Array.from(appState.liveCalls.keys());
                existingCallIds.forEach(id => {
                    const call = appState.liveCalls.get(id);
                    if (call && call.type === 'vapi_agent') {
                        appState.liveCalls.delete(id);
                    }
                });

                // Filter out stale calls (older than 2 hours) and invalid statuses
                const now = new Date();
                const maxAge = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

                dashboardData.activeCalls.forEach(call => {
                    const callStartTime = new Date(call.startedAt || call.createdAt);
                    const callAge = now - callStartTime;

                    // Skip calls that are too old or have ended statuses
                    if (callAge > maxAge ||
                        call.status === 'ended' ||
                        call.status === 'completed' ||
                        call.status === 'failed' ||
                        call.status === 'busy' ||
                        call.status === 'no-answer') {
                        console.log(`🗑️ Skipping stale/ended call ${call.id} (age: ${Math.round(callAge/1000/60)} min, status: ${call.status})`);
                        return;
                    }

                    // Map VAPI statuses to our internal statuses
                    let mappedStatus = call.status;
                    if (call.status === 'in-progress') {
                        mappedStatus = 'in-progress';
                    } else if (call.status === 'ringing') {
                        mappedStatus = 'ringing';
                    } else if (call.status === 'queued') {
                        mappedStatus = 'queued';
                    } else {
                        // For any other status, log it and skip
                        console.log(`⚠️ Unexpected VAPI call status: ${call.status} for call ${call.id}, skipping`);
                        return;
                    }

                    const callData = {
                        id: call.id,
                        type: 'vapi_agent',
                        status: mappedStatus,
                        startTime: callStartTime,
                        duration: call.duration || 0,
                        phoneNumber: call.customer?.number || 'Unknown',
                        agentName: call.assistant?.name || 'Unknown Agent',
                        company: extractCompanyFromAssistant(call.assistant?.name || ''),
                        lastUpdate: new Date()
                    };

                    console.log(`✅ Adding VAPI call to liveCalls: ${call.id} (status: ${mappedStatus})`);
                    appState.liveCalls.set(call.id, callData);
                });

                updateLiveCallsDisplay();
            } else {
                // Fallback to direct VAPI endpoint
                const response = await fetch('/vapi/calls?limit=5&status=in-progress');
                const data = await response.json();

                if (data.success && data.calls) {
                    // Clear old VAPI calls and add current ones
                    const existingCallIds = Array.from(appState.liveCalls.keys());
                    existingCallIds.forEach(id => {
                        const call = appState.liveCalls.get(id);
                        if (call && call.type === 'vapi_agent') {
                            appState.liveCalls.delete(id);
                        }
                    });

                    // Filter out stale calls and invalid statuses
                    const now = new Date();
                    const maxAge = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

                    const currentVapiCalls = data.calls.filter(call => {
                        const callStartTime = new Date(call.startedAt || call.createdAt);
                        const callAge = now - callStartTime;

                        // Filter by status and age
                        return (call.status === 'in-progress' || call.status === 'ringing' || call.status === 'queued') &&
                               callAge <= maxAge &&
                               call.status !== 'ended' &&
                               call.status !== 'completed' &&
                               call.status !== 'failed' &&
                               call.status !== 'busy' &&
                               call.status !== 'no-answer';
                    });

                    currentVapiCalls.forEach(call => {
                        // Map VAPI statuses to our internal statuses
                        let mappedStatus = call.status;
                        if (call.status === 'in-progress') {
                            mappedStatus = 'in-progress';
                        } else if (call.status === 'ringing') {
                            mappedStatus = 'ringing';
                        } else if (call.status === 'queued') {
                            mappedStatus = 'queued';
                        } else {
                            // For any other status, log it and skip
                            console.log(`⚠️ Unexpected VAPI call status in fallback: ${call.status} for call ${call.id}, skipping`);
                            return;
                        }

                        const callData = {
                            id: call.id,
                            type: 'vapi_agent',
                            status: mappedStatus,
                            startTime: new Date(call.startedAt || call.createdAt),
                            duration: call.duration || 0,
                            phoneNumber: call.customer?.number || 'Unknown',
                            agentName: call.assistant?.name || 'Unknown Agent',
                            company: extractCompanyFromAssistant(call.assistant?.name || ''),
                            lastUpdate: new Date()
                        };

                        console.log(`✅ Adding VAPI call to liveCalls (fallback): ${call.id} (status: ${mappedStatus})`);
                        appState.liveCalls.set(call.id, callData);
                    });

                    updateLiveCallsDisplay();
                }
            }

            // Clean up stale calls from liveCalls map
            cleanupStaleCalls();
        } catch (error) {
            console.error('Error checking active calls:', error);
        }
    }, 8000); // Check every 8 seconds

    // Run cleanup every 2 minutes
    setInterval(() => {
        cleanupStaleCalls();
    }, 2 * 60 * 1000); // Every 2 minutes
}

// Clean up stale calls from liveCalls map
function cleanupStaleCalls() {
    const now = new Date();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    const staleCalls = [];

    appState.liveCalls.forEach((call, id) => {
        const callAge = now - new Date(call.startTime);

        // Remove calls that are too old or have ended statuses
        if (callAge > maxAge ||
            call.status === 'ended' ||
            call.status === 'completed' ||
            call.status === 'failed' ||
            call.status === 'busy' ||
            call.status === 'no-answer') {
            staleCalls.push(id);
        }
    });

    if (staleCalls.length > 0) {
        console.log(`🗑️ Cleaning up ${staleCalls.length} stale calls:`, staleCalls);
        staleCalls.forEach(id => appState.liveCalls.delete(id));
        updateLiveCallsDisplay();
    }
}

// Helper function to extract company from assistant name
function extractCompanyFromAssistant(assistantName) {
    const name = assistantName.toLowerCase();
    if (name.includes('coinbase')) return 'Coinbase';
    if (name.includes('kraken')) return 'Kraken';
    if (name.includes('binance')) return 'Binance';
    if (name.includes('microsoft')) return 'Microsoft';
    if (name.includes('apple')) return 'Apple';
    if (name.includes('google')) return 'Google';
    return 'Unknown';
}

// Initialize Server-Sent Events connection for real-time updates
function initializeSSEConnection() {
    try {
        console.log('Initializing SSE connection for real-time updates...');
        console.log('Browser:', navigator.userAgent);
        console.log('Current URL:', window.location.href);

        // Close existing connection if any
        if (appState.sseConnection) {
            console.log('Closing existing SSE connection...');
            appState.sseConnection.close();
        }

        appState.sseConnection = new EventSource('/api/live-updates');
        console.log('SSE connection created, readyState:', appState.sseConnection.readyState);

        appState.sseConnection.onopen = function(event) {
            console.log('✅ SSE connection established successfully');
            console.log('SSE readyState:', appState.sseConnection.readyState);
            console.log('Current live calls:', appState.liveCalls.size);

            // Show a visual indicator that SSE is connected
            const detectionMessage = document.getElementById('detection-message');
            if (detectionMessage) {
                detectionMessage.innerHTML = `
                    <i class="fas fa-wifi" style="color: var(--success-color);"></i>
                    <span>Live updates connected - monitoring for scam calls...</span>
                `;
            }
        };

        appState.sseConnection.onmessage = function(event) {
            try {
                console.log('📨 Received SSE message:', event.data);
                const message = JSON.parse(event.data);

                // Handle connection timeout message
                if (message.type === 'connection_timeout') {
                    console.log('🔄 Server requested reconnection due to timeout');
                    // In serverless environment, fall back to polling instead of reconnecting
                    if (message.serverless || appState.isServerless) {
                        console.log('🔄 Serverless environment detected, switching to polling...');
                        if (appState.sseConnection) {
                            appState.sseConnection.close();
                            appState.sseConnection = null;
                        }
                        setupPeriodicUpdates();
                        return;
                    }
                    setTimeout(() => {
                        initializeSSEConnection();
                    }, 1000); // Reconnect after 1 second
                    return;
                }

                // Detect serverless environment from initial messages
                if (message.serverless) {
                    appState.isServerless = true;
                    console.log('🔄 Serverless environment detected from SSE message');
                }

                handleSSEMessage(message);
            } catch (error) {
                console.error('❌ Error parsing SSE message:', error);
                console.error('Raw message data:', event.data);
            }
        };

        appState.sseConnection.onerror = function(event) {
            // In serverless environments, connection errors are expected
            if (appState.isServerless) {
                console.log('🔄 SSE connection closed (expected in serverless), switching to polling...');
            } else {
                console.error('❌ SSE connection error:', event);
                console.error('SSE readyState:', appState.sseConnection.readyState);
                console.error('SSE url:', appState.sseConnection.url);

                // Log more details about the error
                if (appState.sseConnection.readyState === EventSource.CLOSED) {
                    console.error('SSE connection was closed');
                } else if (appState.sseConnection.readyState === EventSource.CONNECTING) {
                    console.error('SSE connection is still connecting');
                }
            }

            // Fall back to periodic updates instead of trying to reconnect
            console.log('🔄 Switching to polling mode for live updates...');
            if (appState.sseConnection) {
                appState.sseConnection.close();
                appState.sseConnection = null;
            }
            setupPeriodicUpdates();
        };

    } catch (error) {
        console.error('❌ Error initializing SSE connection:', error);
        console.error('Error details:', error.stack);
        // Fallback to periodic updates
        console.log('🔄 Falling back to periodic updates...');
        setupPeriodicUpdates();
    }
}

// Handle SSE messages
function handleSSEMessage(message) {
    console.log('Received SSE message:', message);

    switch (message.type) {
        case 'connected':
            console.log('✅ SSE connected:', message.message);
            break;
        case 'heartbeat':
            console.log('💓 SSE heartbeat received:', message.timestamp);
            break;
        case 'timeout':
            console.log('⏰ SSE timeout, will refresh connection');
            // Connection will be closed by server, frontend will fall back to periodic updates
            break;
        case 'initial_data':
            handleInitialData(message.data);
            break;
        case 'active_calls_update':
            handleActiveCallsUpdate(message.data);
            break;
        case 'incoming_call':
            handleIncomingCall(message.data);
            break;
        case 'call_status_update':
            handleCallStatusUpdate(message.data);
            break;
        case 'vapi_call_started':
            handleVapiCallStarted(message.data);
            break;
        case 'vapi_call_ended':
            handleVapiCallEnded(message.data);
            break;
        case 'vapi_call_failed':
            handleVapiCallFailed(message.data);
            break;
        case 'scam_detected':
            handleScamDetected(message.data);
            break;
        case 'call_processed':
            handleCallProcessed(message.data);
            break;
        case 'vapi_call_created':
            handleVapiCallCreated(message.data);
            break;
        case 'connection_established':
            console.log('✅ SSE connection established:', message.timestamp);

            // Check if this is a serverless environment
            if (message.serverless) {
                console.log('🔄 Serverless SSE detected, preparing for polling mode...');
                appState.isServerless = true;

                // Show visual indicator for serverless mode
                const detectionMessage = document.getElementById('detection-message');
                if (detectionMessage) {
                    detectionMessage.innerHTML = `
                        <i class="fas fa-cloud" style="color: var(--info-color);"></i>
                        <span>Serverless mode - preparing live updates...</span>
                    `;
                }
            } else {
                // Traditional SSE connection
                const detectionMessage = document.getElementById('detection-message');
                if (detectionMessage) {
                    detectionMessage.innerHTML = `
                        <i class="fas fa-wifi" style="color: var(--success-color);"></i>
                        <span>Live updates connected - monitoring for scam calls...</span>
                    `;
                }
            }
            break;
        default:
            console.log('Unknown SSE message type:', message.type);
    }
}

// SSE Message Handlers
function handleInitialData(data) {
    console.log('Received initial data:', data);
    console.log('Initial calls count:', data.calls ? data.calls.length : 0);

    // Update live calls first (counter will be calculated from this)
    appState.liveCalls.clear();
    if (data.calls && Array.isArray(data.calls)) {
        const now = new Date();
        const maxAge = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

        data.calls.forEach(call => {
            const callStartTime = new Date(call.startTime);
            const callAge = now - callStartTime;

            // Skip calls that are too old or have ended statuses
            if (callAge > maxAge ||
                call.status === 'ended' ||
                call.status === 'completed' ||
                call.status === 'failed' ||
                call.status === 'busy' ||
                call.status === 'no-answer' ||
                call.status === 'processing' ||
                call.status === 'recording') {
                console.log(`🗑️ Skipping stale/ended call from initial data: ${call.id} (age: ${Math.round(callAge/1000/60)} min, status: ${call.status})`);
                return;
            }

            console.log('Adding initial call:', call.id, call.status);
            appState.liveCalls.set(call.id, call);
        });
    }

    console.log('Live calls after initial data:', appState.liveCalls.size);

    // Update display (this will automatically update the counter based on live calls)
    updateLiveCallsDisplay();
}

function handleActiveCallsUpdate(data) {
    console.log('Active calls update:', data);

    // Update live calls map (counter will be calculated dynamically)
    appState.liveCalls.clear();
    if (data.calls && Array.isArray(data.calls)) {
        const now = new Date();
        const maxAge = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

        data.calls.forEach(call => {
            const callStartTime = new Date(call.startTime);
            const callAge = now - callStartTime;

            // Skip calls that are too old or have ended statuses
            if (callAge > maxAge ||
                call.status === 'ended' ||
                call.status === 'completed' ||
                call.status === 'failed' ||
                call.status === 'busy' ||
                call.status === 'no-answer' ||
                call.status === 'processing' ||
                call.status === 'recording') {
                console.log(`🗑️ Skipping stale/ended call from SSE: ${call.id} (age: ${Math.round(callAge/1000/60)} min, status: ${call.status})`);
                return;
            }

            // Map VAPI statuses to our internal statuses
            let mappedStatus = call.status;
            if (call.status === 'in-progress') {
                mappedStatus = 'in-progress';
            } else if (call.status === 'ringing') {
                mappedStatus = 'ringing';
            } else if (call.status === 'queued') {
                mappedStatus = 'queued';
            } else {
                // For any other status, log it and skip
                console.log(`⚠️ Unexpected call status from SSE: ${call.status} for call ${call.id}, skipping`);
                return;
            }

            console.log(`✅ Adding call from SSE: ${call.id} (status: ${mappedStatus})`);
            appState.liveCalls.set(call.id, call);
        });
    }

    // Update display (this will automatically update the counter based on live calls)
    updateLiveCallsDisplay();
}

function handleIncomingCall(data) {
    console.log('Incoming call:', data);

    // Add to live calls
    const callData = {
        id: data.callSid,
        type: 'incoming_call',
        status: 'ringing',
        startTime: new Date(data.timestamp),
        duration: 0,
        phoneNumber: data.callerNumber,
        agentName: null,
        company: 'Unknown',
        lastUpdate: new Date(data.timestamp)
    };

    appState.liveCalls.set(data.callSid, callData);
    updateLiveCallsDisplay();

    // Show simplified incoming call alert in detection panel
    showIncomingCallAlert(data.callerNumber);

    // Show simplified notification with consistent redacted phone number
    const redactedNumber = redactPhoneNumber(data.callerNumber);
    showCallNotification('Incoming Call', `Incoming call from ${redactedNumber}`, 'incoming');

    // Play notification sound
    playNotificationSound();
}

function handleCallStatusUpdate(data) {
    console.log('Call status update:', data);

    const call = appState.liveCalls.get(data.callSid);
    if (call) {
        // Handle processing status - remove from Active Calls and show in Live Detection area
        if (data.status === 'processing') {
            console.log('📊 Processing status detected, removing from Active Calls and showing in Live Detection');
            appState.liveCalls.delete(data.callSid); // Remove from Active Calls
            showProcessingAlert(call.phoneNumber);
            // Show external notification for processing
            const redactedNumber = redactPhoneNumber(call.phoneNumber);
            showCallNotification('Call Update', `Processing voicemail from ${redactedNumber} for scam detection`, 'processing');
            updateLiveCallsDisplay();
            return; // Exit early since call is removed
        }

        // Handle recording status - remove from Active Calls and show external notification
        if (data.status === 'recording') {
            console.log('🎤 Recording status detected, removing from Active Calls and showing external notification');
            appState.liveCalls.delete(data.callSid); // Remove from Active Calls
            const redactedNumber = redactPhoneNumber(call.phoneNumber);
            showCallNotification('Call Update', `Recording voicemail from ${redactedNumber}`, 'recording');
            updateLiveCallsDisplay();
            return; // Exit early since call is removed
        }

        // For all other statuses, update the call in liveCalls
        call.status = data.status;
        call.lastUpdate = new Date();
        appState.liveCalls.set(data.callSid, call);
        updateLiveCallsDisplay();

        // Clear incoming call alert if call is no longer ringing/incoming
        if (data.status !== 'ringing' && data.status !== 'incoming') {
            // Check if there are any other incoming calls
            const hasOtherIncomingCalls = Array.from(appState.liveCalls.values()).some(c =>
                c.id !== data.callSid && (c.status === 'ringing' || c.status === 'incoming')
            );

            if (!hasOtherIncomingCalls) {
                clearIncomingCallAlert();
            }
        }

        // Clear processing alert if call is no longer processing
        if (data.status !== 'processing') {
            // Check if there are any other processing calls
            const hasOtherProcessingCalls = Array.from(appState.liveCalls.values()).some(c =>
                c.id !== data.callSid && c.status === 'processing'
            );

            if (!hasOtherProcessingCalls) {
                clearProcessingAlert();
            }
        }

        // Show notification for other status changes (excluding recording and processing which are handled above)
        if (data.message && data.status !== 'recording' && data.status !== 'processing') {
            showCallNotification('Call Update', data.message, data.status);
        }
    }
}

function handleVapiCallStarted(data) {
    console.log('VAPI call started:', data);

    // Add to live calls
    const callData = {
        id: data.callId,
        type: 'vapi_agent',
        status: 'in-progress',
        startTime: new Date(),
        duration: 0,
        phoneNumber: data.phoneNumber,
        agentName: data.agentName,
        company: data.company,
        lastUpdate: new Date()
    };

    appState.liveCalls.set(data.callId, callData);
    updateLiveCallsDisplay();

    // Show notification with redacted phone number
    const redactedNumber = redactPhoneNumber(data.phoneNumber);
    showCallNotification('Agent Call Started', `${data.agentName} calling ${redactedNumber}`, 'in-progress');
}

function handleVapiCallEnded(data) {
    console.log('VAPI call ended:', data);

    // Remove from live calls
    appState.liveCalls.delete(data.callId);
    updateLiveCallsDisplay();

    // Show notification
    const status = data.successful ? 'Success' : 'Completed';
    const duration = Math.floor(data.duration / 60);
    showCallNotification('Agent Call Ended', `Call completed (${duration}m) - ${status}`, 'completed');
}

function handleVapiCallFailed(data) {
    console.log('VAPI call failed:', data);

    // Remove from live calls
    appState.liveCalls.delete(data.callId);
    updateLiveCallsDisplay();

    // Show notification
    showCallNotification('Agent Call Failed', `Call failed: ${data.reason}`, 'failed');
}

function handleScamDetected(data) {
    console.log('🚨 Scam Detected Event:', data);
    updateLiveCallStatus(data.callSid, 'scam_detected', 'Scam Detected!', 'scam_detected');

    const message = `High-confidence scam detected from ${data.company || 'Unknown'}. Type: ${data.scamType || 'Unknown'}.`;
    showCallNotification('Scam Detected!', message, 'scam_detected');
    showBrowserNotification('🚨 Scam Detected!', message);

    // Show a prominent visual alert for all detected scams
    showDetectionAlert({
        company: data.company,
        confidence: data.confidence,
        scamType: data.scamType
    });

    // After a few seconds, change the status to "Initiating Callback"
    setTimeout(() => {
        updateLiveCallStatus(data.callSid, 'initiating_callback', 'Engaging Scammer...', 'initiating_callback');
    }, 4000);
}

function handleCallProcessed(data) {
    console.log('📞 Call Processed Event:', data);
    updateLiveCallStatus(data.callSid, 'processed', 'Call processed', 'processed');

    // Remove from live calls
    appState.liveCalls.delete(data.callSid);
    updateLiveCallsDisplay();

    // Clear incoming call alert if no more incoming calls
    const hasIncomingCalls = Array.from(appState.liveCalls.values()).some(call =>
        call.status === 'ringing' || call.status === 'incoming'
    );

    if (!hasIncomingCalls) {
        clearIncomingCallAlert();
    }

    // Clear processing alert if no more processing calls
    const hasProcessingCalls = Array.from(appState.liveCalls.values()).some(call =>
        call.status === 'processing'
    );

    if (!hasProcessingCalls) {
        clearProcessingAlert();
    }

    // Show notification
    const message = data.scamDetected ?
        `Scam detected! Agent call initiated.` :
        data.message || 'Call processing complete';

    showCallNotification('Call Processed', message, data.scamDetected ? 'success' : 'completed');
}

function handleVapiCallCreated(data) {
    console.log('VAPI call created:', data);

    // Add to live calls
    const callData = {
        id: data.callId,
        type: 'vapi_agent',
        status: 'queued',
        startTime: new Date(),
        duration: 0,
        phoneNumber: data.phoneNumber,
        agentName: data.agentName,
        company: data.company,
        lastUpdate: new Date()
    };

    appState.liveCalls.set(data.callId, callData);
    updateLiveCallsDisplay();

    // Show notification with redacted phone number
    const redactedNumber = redactPhoneNumber(data.phoneNumber);
    showCallNotification('Agent Call Created', `${data.agentName} queued for ${redactedNumber}`, 'queued');
}

// Show detection alert
function showDetectionAlert(scam) {
    const overlay = document.getElementById('detection-overlay');
    const message = document.getElementById('detection-message');

    if (!overlay || !message) return;

    // Update message
    message.innerHTML = `
        <i class="fas fa-exclamation-triangle" style="color: var(--danger-color);"></i>
        <span>Scam Detected: ${scam.company} ${scam.scamType.replace('_', ' ')} scam!</span>
    `;

    // Add alert class
    overlay.classList.add('alert');

    // Remove alert class after 5 seconds
    setTimeout(() => {
        message.innerHTML = `
            <i class="fas fa-shield-alt"></i>
            <span>Monitoring for scam calls...</span>
        `;
        overlay.classList.remove('alert');
    }, 5000);
}

// Show incoming call alert in detection panel
function showIncomingCallAlert(phoneNumber) {
    const panel = document.querySelector('.visualization-panel');
    const overlay = document.getElementById('detection-overlay');
    const message = document.getElementById('detection-message');
    const canvas = document.getElementById('detection-canvas');

    if (!panel || !overlay || !message || !canvas) return;

    // Add alert classes
    panel.classList.add('incoming-alert');
    overlay.classList.add('incoming-call');
    canvas.classList.add('alert-mode');

    // Update message for incoming call with consistent formatting
    message.innerHTML = `
        <i class="fas fa-phone-alt"></i>
        <span>Incoming call from ${redactPhoneNumber(phoneNumber)}</span>
    `;
}

// Clear incoming call alert from detection panel
function clearIncomingCallAlert() {
    const panel = document.querySelector('.visualization-panel');
    const overlay = document.getElementById('detection-overlay');
    const message = document.getElementById('detection-message');
    const canvas = document.getElementById('detection-canvas');

    if (!panel || !overlay || !message || !canvas) return;

    // Remove alert classes
    panel.classList.remove('incoming-alert');
    overlay.classList.remove('incoming-call');
    canvas.classList.remove('alert-mode');

    // Reset message to monitoring state
    message.innerHTML = `
        <i class="fas fa-shield-alt"></i>
        <span>Monitoring for scam calls...</span>
    `;
}

// Show processing alert in detection panel
function showProcessingAlert(phoneNumber) {
    const panel = document.querySelector('.visualization-panel');
    const overlay = document.getElementById('detection-overlay');
    const message = document.getElementById('detection-message');
    const canvas = document.getElementById('detection-canvas');

    if (!panel || !overlay || !message || !canvas) return;

    // Add processing classes
    panel.classList.add('processing-alert');
    overlay.classList.add('processing');
    canvas.classList.add('processing-mode');

    // Update message for processing with consistent formatting
    message.innerHTML = `
        <i class="fas fa-cog fa-spin"></i>
        <span>Analyzing call from ${redactPhoneNumber(phoneNumber)} for scams</span>
    `;
}

// Clear processing alert from detection panel
function clearProcessingAlert() {
    const panel = document.querySelector('.visualization-panel');
    const overlay = document.getElementById('detection-overlay');
    const message = document.getElementById('detection-message');
    const canvas = document.getElementById('detection-canvas');

    if (!panel || !overlay || !message || !canvas) return;

    // Remove processing classes
    panel.classList.remove('processing-alert');
    overlay.classList.remove('processing');
    canvas.classList.remove('processing-mode');

    // Reset message to monitoring state
    message.innerHTML = `
        <i class="fas fa-shield-alt"></i>
        <span>Monitoring for scam calls...</span>
    `;
}

// Debug Panel Toggle Functions
function setupDebugPanelToggle() {
    const debugToggleBtn = document.getElementById('debug-toggle-btn');
    const collapseDebugBtn = document.getElementById('collapse-debug-btn');
    const debugPanel = document.getElementById('debug-panel');

    if (debugToggleBtn && debugPanel) {
        debugToggleBtn.addEventListener('click', () => {
            toggleDebugPanel();
        });
    }

    if (collapseDebugBtn && debugPanel) {
        collapseDebugBtn.addEventListener('click', () => {
            toggleDebugPanel();
        });
    }

    // Close debug panel when clicking outside (optional)
    document.addEventListener('click', (e) => {
        if (debugPanel && !debugPanel.contains(e.target) &&
            !debugToggleBtn.contains(e.target) &&
            !debugPanel.classList.contains('collapsed')) {
            // Only close if clicking outside and panel is open
            // Uncomment the line below if you want click-outside-to-close behavior
            // toggleDebugPanel();
        }
    });

    // Keyboard shortcut to toggle debug panel (Ctrl/Cmd + D)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            toggleDebugPanel();
        }
    });
}

function toggleDebugPanel() {
    const debugPanel = document.getElementById('debug-panel');
    const debugToggleBtn = document.getElementById('debug-toggle-btn');
    const collapseIcon = document.getElementById('collapse-debug-btn')?.querySelector('i');

    if (debugPanel) {
        const isCollapsed = debugPanel.classList.contains('collapsed');

        if (isCollapsed) {
            // Show panel
            debugPanel.classList.remove('collapsed');
            if (debugToggleBtn) {
                debugToggleBtn.style.transform = 'translateY(-10px)';
            }
            if (collapseIcon) {
                collapseIcon.className = 'fas fa-chevron-down';
            }
        } else {
            // Hide panel
            debugPanel.classList.add('collapsed');
            if (debugToggleBtn) {
                debugToggleBtn.style.transform = 'translateY(0)';
            }
            if (collapseIcon) {
                collapseIcon.className = 'fas fa-chevron-up';
            }
        }
    }
}

// VAPI Management Functions
function setupVapiEventListeners() {
    // List assistants button
    const listAssistantsBtn = document.getElementById('list-assistants-btn');
    if (listAssistantsBtn) {
        listAssistantsBtn.addEventListener('click', async () => {
            await handleVapiAction(listAssistantsBtn, 'List Assistants', async () => {
                const response = await fetch('/vapi/assistants');
                return await response.json();
            });
        });
    }

    // List phone numbers button
    const listPhoneNumbersBtn = document.getElementById('list-phone-numbers-btn');
    if (listPhoneNumbersBtn) {
        listPhoneNumbersBtn.addEventListener('click', async () => {
            await handleVapiAction(listPhoneNumbersBtn, 'Phone Numbers', async () => {
                const response = await fetch('/vapi/phone-numbers');
                return await response.json();
            });
        });
    }

    // Get analytics button
    const getAnalyticsBtn = document.getElementById('get-analytics-btn');
    if (getAnalyticsBtn) {
        getAnalyticsBtn.addEventListener('click', async () => {
            await handleVapiAction(getAnalyticsBtn, 'Call Analytics', async () => {
                const response = await fetch('/vapi/analytics');
                return await response.json();
            });
        });
    }

    // List VAPI calls button
    const listVapiCallsBtn = document.getElementById('list-vapi-calls-btn');
    if (listVapiCallsBtn) {
        listVapiCallsBtn.addEventListener('click', async () => {
            await handleVapiAction(listVapiCallsBtn, 'VAPI Calls', async () => {
                const response = await fetch('/vapi/calls');
                return await response.json();
            });
        });
    }

    // Find agent button
    const findAgentBtn = document.getElementById('find-agent-btn');
    if (findAgentBtn) {
        findAgentBtn.addEventListener('click', async () => {
            const company = prompt('Enter company name to find agent for (e.g., Coinbase, Kraken):');
            if (!company) return;

            await handleVapiAction(findAgentBtn, 'Find Agent', async () => {
                const response = await fetch(`/vapi/find-agent?company=${encodeURIComponent(company)}`);
                return await response.json();
            });
        });
    }

    // Test call button
    const testCallBtn = document.getElementById('test-call-btn');
    if (testCallBtn) {
        testCallBtn.addEventListener('click', async () => {
            const phoneNumber = prompt('Enter phone number to test (e.g., +1234567890):');
            if (!phoneNumber) return;

            const scamType = prompt('Enter scam type (crypto_exchange, it_support, or leave empty for default):', 'crypto_exchange');

            await handleVapiAction(testCallBtn, 'Test Call', async () => {
                const response = await fetch('/vapi/test-call', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        phoneNumber: phoneNumber,
                        scamType: scamType || 'crypto_exchange'
                    })
                });
                return await response.json();
            });
        });
    }

    // Close results button
    const closeResultsBtn = document.getElementById('close-results-btn');
    if (closeResultsBtn) {
        closeResultsBtn.addEventListener('click', () => {
            hideVapiResults();
        });
    }

    // Refresh VAPI data button
    const refreshVapiBtn = document.getElementById('refresh-vapi-btn');
    if (refreshVapiBtn) {
        refreshVapiBtn.addEventListener('click', async () => {
            // Refresh all VAPI data
            refreshVapiBtn.classList.add('loading');
            try {
                // Clear any existing results
                hideVapiResults();

                // You could add logic here to refresh cached data
                console.log('Refreshing VAPI data...');

                // Refresh dashboard data
                await loadDashboardData();

                console.log('VAPI data refreshed');
            } catch (error) {
                console.error('Error refreshing VAPI data:', error);
            } finally {
                refreshVapiBtn.classList.remove('loading');
            }
        });
    }
}

// Handle VAPI action with loading states and error handling
async function handleVapiAction(button, title, action) {
    // Set loading state
    button.classList.add('loading');
    button.disabled = true;

    try {
        // Execute the action
        const result = await action();

        // Show results
        showVapiResults(title, result);

        // Set success state briefly
        button.classList.remove('loading');
        button.classList.add('success');
        setTimeout(() => {
            button.classList.remove('success');
            button.disabled = false;
        }, 1000);

    } catch (error) {
        console.error(`Error in ${title}:`, error);

        // Show error
        showVapiResults(`${title} - Error`, {
            error: error.message,
            details: error.toString()
        });

        // Set error state briefly
        button.classList.remove('loading');
        button.classList.add('error');
        setTimeout(() => {
            button.classList.remove('error');
            button.disabled = false;
        }, 2000);
    }
}

// Redact sensitive information from debug output
function redactSensitiveData(data) {
    if (!data) return data;

    // Create a deep copy to avoid modifying the original data
    const redactedData = JSON.parse(JSON.stringify(data));

    // Phone number patterns to redact
    const phonePatterns = [
        /\+1\d{10}/g,           // +1XXXXXXXXXX
        /\+\d{1,3}\d{7,14}/g,   // International numbers
        /\(\d{3}\)\s?\d{3}-?\d{4}/g, // (XXX) XXX-XXXX
        /\d{3}-?\d{3}-?\d{4}/g  // XXX-XXX-XXXX
    ];

    function redactPhoneNumber(phoneNumber) {
        if (!phoneNumber || typeof phoneNumber !== 'string') {
            return phoneNumber;
        }

        // Remove all non-digit characters to get clean number
        const digitsOnly = phoneNumber.replace(/\D/g, '');

        if (digitsOnly.length < 6) {
            return phoneNumber; // Too short to redact meaningfully
        }

        if (digitsOnly.length === 10) {
            // US number without country code: XXX-XXX-XXXX -> +1-XXX-***-**XX
            return `+1-${digitsOnly.substring(0, 3)}-***-**${digitsOnly.substring(8)}`;
        } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
            // US number with country code: 1XXXXXXXXXX -> +1-XXX-***-**XX
            return `+1-${digitsOnly.substring(1, 4)}-***-**${digitsOnly.substring(9)}`;
        } else {
            // International or other format: show first 4 and last 2 digits
            const firstPart = digitsOnly.substring(0, Math.min(4, digitsOnly.length - 2));
            const lastPart = digitsOnly.substring(digitsOnly.length - 2);
            const maskedLength = Math.max(0, digitsOnly.length - 6);
            const masked = '*'.repeat(maskedLength);
            return `+${firstPart}${masked}${lastPart}`;
        }
    }

    function redactObject(obj) {
        if (Array.isArray(obj)) {
            return obj.map(item => redactObject(item));
        } else if (obj && typeof obj === 'object') {
            const redacted = {};
            for (const [key, value] of Object.entries(obj)) {
                // Check if this field likely contains a phone number
                if (typeof value === 'string' && (
                    key.toLowerCase().includes('phone') ||
                    key.toLowerCase().includes('number') ||
                    key.toLowerCase().includes('caller') ||
                    key.toLowerCase().includes('customer') ||
                    phonePatterns.some(pattern => pattern.test(value))
                )) {
                    redacted[key] = redactPhoneNumber(value);
                } else {
                    redacted[key] = redactObject(value);
                }
            }
            return redacted;
        } else if (typeof obj === 'string') {
            // Redact any phone numbers found in string values
            let redactedString = obj;
            phonePatterns.forEach(pattern => {
                redactedString = redactedString.replace(pattern, (match) => redactPhoneNumber(match));
            });
            return redactedString;
        }
        return obj;
    }

    return redactObject(redactedData);
}

// Show VAPI results
function showVapiResults(title, data) {
    const resultsContainer = document.getElementById('vapi-results');
    const resultsTitle = document.getElementById('results-title');
    const resultsOutput = document.getElementById('results-output');

    if (resultsContainer && resultsTitle && resultsOutput) {
        resultsTitle.textContent = title;

        // Redact sensitive information before displaying
        const redactedData = redactSensitiveData(data);
        resultsOutput.textContent = JSON.stringify(redactedData, null, 2);

        resultsContainer.style.display = 'block';

        // Scroll to results
        resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Hide VAPI results
function hideVapiResults() {
    const resultsContainer = document.getElementById('vapi-results');
    if (resultsContainer) {
        resultsContainer.style.display = 'none';
    }
}

// Load and display leaderboard
async function loadLeaderboard() {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;

    try {
        // Show loading state
        container.innerHTML = '<div class="loading-message">Loading leaderboard...</div>';

        // Fetch analytics data
        const response = await fetch('/vapi/analytics');
        const data = await response.json();

        if (data.success && data.analytics && data.analytics.leaderboard) {
            renderLeaderboard(data.analytics.leaderboard);
        } else {
            container.innerHTML = '<div class="loading-message">No leaderboard data available</div>';
        }
    } catch (error) {
        console.error('Error loading leaderboard:', error);
        container.innerHTML = '<div class="loading-message">Error loading leaderboard</div>';
    }
}

// Render leaderboard
function renderLeaderboard(leaderboard) {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;

    if (!leaderboard || leaderboard.length === 0) {
        container.innerHTML = '<div class="loading-message">No agents found</div>';
        return;
    }

    container.innerHTML = '';

    leaderboard.forEach((agent, index) => {
        const rank = index + 1;
        const item = document.createElement('div');
        item.className = 'leaderboard-item';

        // Determine rank class
        let rankClass = 'other';
        if (rank === 1) rankClass = 'first';
        else if (rank === 2) rankClass = 'second';
        else if (rank === 3) rankClass = 'third';

        item.innerHTML = `
            <div class="leaderboard-rank">
                <div class="rank-number ${rankClass}">${rank}</div>
                <div class="agent-name">${agent.name}</div>
            </div>
            <div class="leaderboard-stats">
                <div class="stat-item">
                    <div class="stat-value">${agent.totalCalls}</div>
                    <div class="stat-label">Calls</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${agent.totalTime}m</div>
                    <div class="stat-label">Time</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${agent.avgDuration.toFixed(1)}m</div>
                    <div class="stat-label">Avg</div>
                </div>
                <div class="stat-item">
                    <div class="success-rate">
                        <div class="success-rate-bar">
                            <div class="success-rate-fill" style="width: ${agent.successRate}%"></div>
                        </div>
                        <span class="stat-value">${agent.successRate.toFixed(0)}%</span>
                    </div>
                    <div class="stat-label">Success</div>
                </div>
            </div>
        `;

        container.appendChild(item);
    });
}
