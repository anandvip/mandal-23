// Constants
const SESSION_DURATION = 873; // 14 minutes and 33 seconds in seconds
const TOTAL_SESSIONS = 96; // 48 days * 2 sessions per day
const MAX_PLAYLIST_ITEMS = 3;

// Utility Functions
const formatDate = (date) => date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [hours, minutes, secs].map(v => v.toString().padStart(2, '0')).join(':');
};
const sanitizeHTML = (str) => {
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
};
const getSessionTime = (date) => date.getHours() < 12 ? 'Morning' : 'Evening';

// MeditationStore Class
class MeditationStore {
    constructor() {
        this.state = {
            activeMandal: null,
            sessions: [],
            sortAscending: true,
            theme: 'light',
            timerRunning: false,
            timerSeconds: 0,
            userName: 'Your Name',
            playlists: {
                youtube: [],
                soundcloud: []
            }
        };
        this.observers = [];
        this.timerWorker = null;
        this.loadFromLocalStorage();
    }

    addObserver(observer) {
        this.observers.push(observer);
    }

    notifyObservers() {
        this.observers.forEach(observer => observer.update(this.state));
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };
        this.saveToLocalStorage();
        this.notifyObservers();
    }

    createMandal(mandalData) {
        if (this.state.activeMandal) {
            throw new Error("An active Mandal already exists. Please complete or delete it before creating a new one.");
        }
        this.setState({ activeMandal: mandalData, sessions: [] });
    }

    addSession(sessionData) {
        this.setState({
            sessions: [...this.state.sessions, sessionData],
            currentStreak: this.calculateStreak()
        });
    }

    deleteSession(index) {
        const newSessions = [...this.state.sessions];
        newSessions.splice(index, 1);
        this.setState({
            sessions: newSessions,
            currentStreak: this.calculateStreak()
        });
    }

    updateSessionNotes(index, notes) {
        const newSessions = [...this.state.sessions];
        newSessions[index].notes = notes;
        this.setState({ sessions: newSessions });
    }

    toggleSortOrder() {
        this.setState({ sortAscending: !this.state.sortAscending });
    }

    toggleTheme() {
        const newTheme = this.state.theme === 'light' ? 'dark' : 'light';
        this.setState({ theme: newTheme });
        document.body.classList.toggle('dark-mode', newTheme === 'dark');
    }

    saveToLocalStorage() {
        try {
            localStorage.setItem('meditationTrackerState', JSON.stringify(this.state));
        } catch (error) {
            console.error('Failed to save data to local storage:', error);
        }
    }

    loadFromLocalStorage() {
        try {
            const savedState = JSON.parse(localStorage.getItem('meditationTrackerState'));
            if (savedState) {
                if (savedState.activeMandal) {
                    savedState.activeMandal.startDate = new Date(savedState.activeMandal.startDate);
                    savedState.activeMandal.endDate = new Date(savedState.activeMandal.endDate);
                }
                savedState.sessions = savedState.sessions.map(session => ({
                    ...session,
                    date: new Date(session.date)
                }));
                this.setState(savedState);
            }
        } catch (error) {
            console.error('Failed to load data from local storage:', error);
        }
    }

    calculateStreak() {
        if (this.state.sessions.length === 0) return 0;
        let streak = 0;
        let currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);

        const sortedSessions = [...this.state.sessions].sort((a, b) => b.date - a.date);

        for (let i = 0; i < sortedSessions.length; i++) {
            const sessionDate = new Date(sortedSessions[i].date);
            sessionDate.setHours(0, 0, 0, 0);

            const dayDifference = Math.round((currentDate - sessionDate) / (1000 * 60 * 60 * 24));

            if (dayDifference === streak) {
                streak++;
                currentDate = sessionDate;
            } else if (dayDifference > streak) {
                break;
            }
        }

        return streak;
    }

    getWeeklyStats() {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const weekSessions = this.state.sessions.filter(session => session.date >= oneWeekAgo);
        const totalTime = weekSessions.reduce((sum, session) => sum + session.duration, 0);
        const averageTime = weekSessions.length > 0 ? totalTime / weekSessions.length : 0;
        return {
            sessionsCount: weekSessions.length,
            totalTime,
            averageTime
        };
    }

    searchNotes(query) {
        const lowercaseQuery = query.toLowerCase();
        return this.state.sessions.filter(session =>
            session.notes.toLowerCase().includes(lowercaseQuery)
        );
    }

    startTimer() {
        if (!this.timerWorker) {
            const workerCode = `
                let timerInterval;
                let seconds = 0;

                self.onmessage = function(e) {
                    if (e.data.command === 'start') {
                        seconds = 0;
                        timerInterval = setInterval(() => {
                            seconds++;
                            self.postMessage({ type: 'tick', seconds: seconds });
                        }, 1000);
                    } else if (e.data.command === 'stop') {
                        clearInterval(timerInterval);
                        self.postMessage({ type: 'stopped', seconds: seconds });
                    }
                };
            `;

            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            this.timerWorker = new Worker(workerUrl);

            this.timerWorker.onmessage = (e) => {
                if (e.data.type === 'tick') {
                    this.setState({ timerSeconds: e.data.seconds });
                    if (e.data.seconds >= SESSION_DURATION) {
                        this.stopTimer();
                    }
                } else if (e.data.type === 'stopped') {
                    this.addSession({
                        date: new Date(),
                        duration: Math.min(e.data.seconds, SESSION_DURATION),
                        notes: ''
                    });
                }
            };
        }
        this.timerWorker.postMessage({ command: 'start' });
        this.setState({ timerRunning: true, timerSeconds: 0 });
    }

    stopTimer() {
        if (this.timerWorker) {
            this.timerWorker.postMessage({ command: 'stop' });
        }
        this.setState({ timerRunning: false });
    }

    cleanup() {
        if (this.timerWorker) {
            this.timerWorker.terminate();
            this.timerWorker = null;
        }
    }

    setUserName(name) {
        this.setState({ userName: name });
    }

    addToPlaylist(type, url, title) {
        if (!['youtube', 'soundcloud'].includes(type)) {
            throw new Error('Invalid playlist type');
        }

        if (this.state.playlists[type].length < MAX_PLAYLIST_ITEMS) {
            const newPlaylists = { ...this.state.playlists };
            newPlaylists[type].push({ url, title });
            this.setState({ playlists: newPlaylists });
            showToast(`Added to ${type} playlist successfully.`);
        } else {
            showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} playlist is full. Remove an item before adding a new one.`);
        }
    }

    removeFromPlaylist(type, index) {
        if (!['youtube', 'soundcloud'].includes(type)) {
            throw new Error('Invalid playlist type');
        }

        const newPlaylists = { ...this.state.playlists };
        newPlaylists[type].splice(index, 1);
        this.setState({ playlists: newPlaylists });
        showToast(`Removed from ${type} playlist.`);
    }
}

// UI Update Functions
function updateMeditationInfo(state) {
    const { activeMandal, sessions } = state;
    let infoContainer = document.getElementById('meditationInfo');

    if (!infoContainer) {
        console.warn('Meditation info container not found in the DOM. Creating it.');
        infoContainer = document.createElement('div');
        infoContainer.id = 'meditationInfo';
        // Insert it as the first child of the main container or body
        const mainContainer = document.querySelector('.container') || document.body;
        mainContainer.insertBefore(infoContainer, mainContainer.firstChild);
    }

    if (!activeMandal) {
        infoContainer.innerHTML = `<p>No active Mandal. Create one to start tracking.</p>`;
        return;
    }

    const now = new Date();
    const startDate = new Date(activeMandal.startDate);
    const endDate = new Date(activeMandal.endDate);
    const totalDays = activeMandal.duration;
    const daysPassed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const daysRemaining = Math.max(0, totalDays - daysPassed);

    const sessionsToday = sessions.filter(s => 
        s.date.getFullYear() === now.getFullYear() &&
        s.date.getMonth() === now.getMonth() &&
        s.date.getDate() === now.getDate()
    ).length;

    infoContainer.innerHTML = `
        <h2>${activeMandal.name}</h2>
        <p>Day ${daysPassed} of ${totalDays} Day Mandal</p>
        <p>Today: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}</p>
        <p>Days Remaining: ${daysRemaining}</p>
        <p>Sessions Today: ${sessionsToday}</p>
        <p>Total Sessions: ${sessions.length}</p>
    `;
}

function updateMeditationVisualization(state) {
    const { activeMandal, sessions } = state;
    const canvas = document.getElementById('meditationVisualization');
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!activeMandal) {
        return;
    }

    const startDate = new Date(activeMandal.startDate);
    const totalDays = activeMandal.duration;
    const now = new Date();
    const daysPassed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24)) + 1;

    const cellSize = Math.min(Math.floor(width / totalDays), 20);
    const startX = (width - (totalDays * cellSize)) / 2;
    const startY = 20;

    for (let i = 0; i < totalDays; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const sessionsOnDay = sessions.filter(s => 
            s.date.getFullYear() === date.getFullYear() &&
            s.date.getMonth() === date.getMonth() &&
            s.date.getDate() === date.getDate()
        );

        const x = startX + (i * cellSize);
        
        if (i === daysPassed - 1) {
            ctx.fillStyle = 'yellow';
            ctx.fillRect(x - 1, startY - 1, cellSize + 2, cellSize + 2);
        }

        ctx.fillStyle = sessionsOnDay.length > 0 ? 'var(--primary-color)' : '#e0e0e0';
        ctx.fillRect(x, startY, cellSize - 1, cellSize - 1);

        if (sessionsOnDay.length > 0) {
            ctx.fillStyle = '#fff';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(sessionsOnDay.length.toString(), x + cellSize / 2, startY + cellSize / 2 + 3);
        }
    }

    // Add legend
    const legendX = 10;
    const legendY = canvas.height - 30;
    ctx.fillStyle = 'var(--primary-color)';
    ctx.fillRect(legendX, legendY, 20, 20);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(legendX + 30, legendY, 20, 20);
    ctx.fillStyle = 'yellow';
    ctx.fillRect(legendX + 60, legendY, 20, 20);
    ctx.fillStyle = 'var(--text-color)';
    ctx.font = '12px Arial';
    ctx.fillText('Meditation day', legendX + 90, legendY + 15);
    ctx.fillText('No meditation', legendX + 180, legendY + 15);
    ctx.fillText('Current day', legendX + 270, legendY + 15);
}

function updateDashboard(state) {
    const { activeMandal, sessions } = state;
    if (!activeMandal) return;

    const dashboardElement = document.getElementById('dashboard');
    const now = new Date();
    const totalDays = (activeMandal.endDate - activeMandal.startDate) / (1000 * 60 * 60 * 24);
    const daysPassed = Math.max(0, Math.min(totalDays, (now - activeMandal.startDate) / (1000 * 60 * 60 * 24)));
    const progress = Math.round((daysPassed / totalDays) * 100);

    const totalTime = sessions.reduce((sum, session) => sum + session.duration, 0);
    const sessionsCount = sessions.length;

    const streak = store.calculateStreak();
    const weeklyStats = store.getWeeklyStats();

    dashboardElement.innerHTML = `
        <div class="dashboard-item">
            <h3>Mandal Progress</h3>
            <div class="circular-progress" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
                <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="#e0e0e0" stroke-width="10" />
                   <circle cx="50" cy="50" r="45" fill="none" stroke="var(--primary-color)" stroke-width="10" stroke-dasharray="${progress * 2.83} 283" />
                </svg>
                <div class="circular-progress-text">${progress}%</div>
            </div>
            <p>Start Date: ${formatDate(activeMandal.startDate)}</p>
            <p>End Date: ${formatDate(activeMandal.endDate)}</p>
            <p>Days Remaining: ${Math.max(0, Math.ceil(totalDays - daysPassed))}</p>
        </div>
        <div class="dashboard-item">
            <h3>Session Statistics</h3>
            <div class="circular-progress" role="progressbar" aria-valuenow="${sessionsCount}" aria-valuemin="0" aria-valuemax="${TOTAL_SESSIONS}">
                <svg viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" fill="none" stroke="#e0e0e0" stroke-width="10" />
                    <circle cx="50" cy="50" r="45" fill="none" stroke="var(--secondary-color)" stroke-width="10" stroke-dasharray="${(sessionsCount / TOTAL_SESSIONS) * 283} 283" />
                </svg>
                <div class="circular-progress-text">${sessionsCount}/${TOTAL_SESSIONS}</div>
            </div>
            <p>Total Meditation Time: ${formatTime(totalTime)}</p>
            <p>Average Session Duration: ${formatTime(totalTime / sessionsCount || 0)}</p>
        </div>
        <div class="dashboard-item">
            <h3>Current Streak</h3>
            <div class="streak-display">
                <span id="currentStreak">${streak}</span> days
            </div>
        </div>
        <div class="dashboard-item">
            <h3>This Week's Progress</h3>
            <p>Sessions: ${weeklyStats.sessionsCount}</p>
            <p>Total Time: ${formatTime(weeklyStats.totalTime)}</p>
            <p>Average Time: ${formatTime(weeklyStats.averageTime)}</p>
        </div>
        <div class="dashboard-item">
            <h3>Quick Add</h3>
            <button id="addTodaySession" aria-label="Add Session for Today">Add Session for Today</button>
        </div>
    `;

    document.getElementById('activeMandalName').textContent = activeMandal.name;
    document.getElementById('addTodaySession').addEventListener('click', handleAddTodaySession);
}

function displaySessionHistory(state, searchQuery = '') {
    const { sessions, sortAscending } = state;
    const historyContent = document.getElementById('historyContent');
    
    if (sessions.length === 0) {
        historyContent.innerHTML = "<p>No meditation sessions recorded yet.</p>";
        return;
    }

    const sortedSessions = [...sessions].sort((a, b) => 
        sortAscending ? a.date - b.date : b.date - a.date
    );

    historyContent.innerHTML = sortedSessions.map((session, index) => `
        <div class="session-entry">
            <div class="session-header">
                <span class="session-time">${session.period || getSessionTime(session.date)}</span><br>
                <span class="session-date">${formatDate(session.date)} - ${formatTime(session.duration)}</span>
            </div>
            <div class="editable-notes" contenteditable="true" data-index="${index}" onblur="handleSaveNotes(event)" aria-label="Session notes">
                ${highlightSearchTerm(sanitizeHTML(session.notes), searchQuery)}
            </div>
            <div class="session-controls">
                <button class="danger-btn" onclick="handleDeleteSession(${index})" aria-label="Delete Session">Delete Session</button>
                <button class="format-btn" onclick="toggleFormatMenu(${index})" aria-label="Format Notes">Format</button>
                <div class="format-menu" id="formatMenu-${index}" style="display: none;">
                    <button class="format-button" onclick="applyFormat('bold', ${index})">Bold</button>
                    <button class="format-button" onclick="applyFormat('italic', ${index})">Italic</button>
                    <button class="format-button" onclick="applyFormat('underline', ${index})">Underline</button>
                    <button class="format-button" onclick="applyFormat('strikeThrough', ${index})">Strike Through</button>
                    <button class="format-button" onclick="applyFormat('removeFormat', ${index})">Remove Formatting</button>
                </div>
            </div>
        </div>
    `).join('');
}

function updateTimerDisplay(seconds) {
    const timerElement = document.getElementById('timer');
    timerElement.textContent = formatTime(seconds);
}

function updateTimerControls(timerRunning) {
    const startButton = document.getElementById('startSession');
    const stopButton = document.getElementById('stopSession');
    startButton.style.display = timerRunning ? 'none' : 'inline-block';
    stopButton.style.display = timerRunning ? 'inline-block' : 'none';
}

function updatePlaylistUI(playlists) {
    const youtubeList = document.getElementById('youtubePlaylist');
    const soundcloudList = document.getElementById('soundcloudPlaylist');

    youtubeList.innerHTML = playlists.youtube.map((item, index) => `
        <li>
            <a href="${item.url}" target="_blank" rel="noopener noreferrer">${sanitizeHTML(item.title)}</a>
            <button onclick="store.removeFromPlaylist('youtube', ${index})">Remove</button>
        </li>
    `).join('');

    soundcloudList.innerHTML = playlists.soundcloud.map((item, index) => `
        <li>
            <a href="${item.url}" target="_blank" rel="noopener noreferrer">${sanitizeHTML(item.title)}</a>
            <button onclick="store.removeFromPlaylist('soundcloud', ${index})">Remove</button>
        </li>
    `).join('');
}

// Event Handlers
function handleCreateMandal() {
    const name = document.getElementById('mandalName').value.trim();
    const duration = parseInt(document.getElementById('mandalDuration').value);
    const startDate = new Date(document.getElementById('startDate').value);
    
    if (!name || isNaN(startDate.getTime())) {
        showToast('Please enter a valid Mandal name and start date.');
        return;
    }
    
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + duration);
    
    try {
        store.createMandal({ name, startDate, endDate, duration });
        showToast('Mandal created successfully!');
        
        document.getElementById('activeMandalInfo').style.display = 'block';
        document.getElementById('sessionHistory').style.display = 'block';
        document.getElementById('mandalCreation').style.display = 'none';
    } catch (error) {
        showToast('Failed to create Mandal. Please check your inputs and try again.');
    }
}

function handleAddPastSession(event) {
    event.preventDefault();
    const pastDate = new Date(document.getElementById('pastDate').value);
    const addMorning = document.getElementById('morningSession').checked;
    const addEvening = document.getElementById('eveningSession').checked;

    if (isNaN(pastDate.getTime())) {
        showToast('Please select a valid date.');
        return;
    }

    try {
        if (addMorning) {
            const morningDate = new Date(pastDate);
            morningDate.setHours(8, 0, 0, 0);
            store.addSession({
                date: morningDate,
                duration: SESSION_DURATION,
                notes: '',
                period: 'Morning'
            });
        }

        if (addEvening) {
            const eveningDate = new Date(pastDate);
            eveningDate.setHours(20, 0, 0, 0);
            store.addSession({
                date: eveningDate,
                duration: SESSION_DURATION,
                notes: '',
                period: 'Evening'
            });
        }

        closeModal('pastSessionModal');
        showToast('Past session(s) added successfully.');
    } catch (error) {
        showToast('Failed to add past session(s)');
    }
}

function handleDeleteSession(index) {
    if (confirm('Are you sure you want to delete this session?')) {
        try {
            store.deleteSession(index);
            showToast('Session deleted successfully.');
        } catch (error) {
            showToast('Failed to delete session');
        }
    }
}

function handleSaveNotes(event) {
    const index = parseInt(event.target.dataset.index);
    const notes = event.target.textContent;
    try {
        store.updateSessionNotes(index, sanitizeHTML(notes));
        showToast('Notes saved successfully.');
    } catch (error) {
        showToast('Failed to save notes');
    }
}

function handleAddTodaySession() {
    const now = new Date();
    try {
        store.addSession({
            date: now,
            duration: SESSION_DURATION,
            notes: '',
            period: getSessionTime(now)
        });
        showToast('Session added for today.');
    } catch (error) {
        showToast('Failed to add today\'s session');
    }
}

function handleSearch() {
    const query = document.getElementById('searchInput').value;
    try {
        const searchResults = store.searchNotes(query);
        displaySessionHistory({ ...store.state, sessions: searchResults }, query);
    } catch (error) {
        showToast('Failed to perform search');
    }
}

function handleStartSession() {
    try {
        store.startTimer();
        updateTimerControls(true);
    } catch (error) {
        showToast('Failed to start session');
    }
}

function handleStopSession() {
    try {
        store.stopTimer();
        updateTimerControls(false);
        showToast('Session completed and saved.');
    } catch (error) {
        showToast('Failed to stop session');
    }
}

function handleEmbedMedia() {
    const mediaUrl = document.getElementById('mediaUrl').value.trim();
    const mediaContainer = document.getElementById('mediaContainer');
    
    if (!mediaUrl) {
        showToast('Please enter a valid URL.');
        return;
    }

    try {
        const url = new URL(mediaUrl);
        
        if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
            const videoId = extractYouTubeId(mediaUrl);
            if (videoId) {
                const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
                const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/0.jpg`;
                const startTime = extractYouTubeStartTime(mediaUrl);

                mediaContainer.innerHTML = `
                    <div class="youtube-preview">
                        <img src="${thumbnailUrl}" alt="Video thumbnail" style="width: 100%; max-width: 480px;">
                        <button onclick="playYouTubeVideo('${embedUrl}', ${startTime})" class="play-button">Play Video</button>
                    </div>
                `;
                store.addToPlaylist('youtube', mediaUrl, `YouTube Video: ${videoId}`);
                showToast('YouTube video added to playlist. Click to play.');
            } else {
                throw new Error('Invalid YouTube URL. Please check and try again.');
            }
        } else if (url.hostname.includes('soundcloud.com')) {
            const embedUrl = `https://w.soundcloud.com/player/?url=${encodeURIComponent(mediaUrl)}`;
            mediaContainer.innerHTML = `
                <iframe 
                    width="100%" 
                    height="166" 
                    scrolling="no" 
                    frameborder="no" 
                    allow="autoplay" 
                    src="${embedUrl}"
                    title="SoundCloud audio player">
                </iframe>`;
            store.addToPlaylist('soundcloud', mediaUrl, `SoundCloud Track: ${url.pathname.split('/').pop()}`);
            showToast('SoundCloud track added to playlist.');
        } else {
            throw new Error('Unsupported media URL. Please enter a YouTube or SoundCloud URL.');
        }
    } catch (error) {
        showToast('Failed to embed media: ' + error.message);
    }
}

// Utility Functions
function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function extractYouTubeStartTime(url) {
    const regExp = /[?&]t=(\d+)/;
    const match = url.match(regExp);
    return match ? parseInt(match[1]) : 0;
}

function playYouTubeVideo(embedUrl, startTime) {
    const mediaContainer = document.getElementById('mediaContainer');
    mediaContainer.innerHTML = `
        <iframe 
            width="560" 
            height="315" 
            src="${embedUrl}?autoplay=1&start=${startTime}"
            frameborder="0" 
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" 
            allowfullscreen
            title="YouTube video player">
        </iframe>`;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
    document.getElementById(modalId).setAttribute('aria-hidden', 'false');
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    document.getElementById(modalId).setAttribute('aria-hidden', 'true');
}

function highlightSearchTerm(text, searchTerm) {
    if (!searchTerm) return text;
    const regex = new RegExp(`(${searchTerm})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
}

function toggleFormatMenu(index) {
    const menu = document.getElementById(`formatMenu-${index}`);
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function applyFormat(format, index) {
    document.execCommand(format, false, null);
    document.getElementById(`formatMenu-${index}`).style.display = 'none';
}

function handleSubmitFeedback() {
    const feedbackText = document.getElementById('feedbackText').value.trim();
    if (feedbackText) {
        // Here you would typically send the feedback to a server
        console.log('Feedback submitted:', feedbackText);
        showToast('Thank you for your feedback!');
        closeModal('feedbackModal');
        document.getElementById('feedbackText').value = '';
   } else {
        showToast('Please enter your feedback before submitting.');
    }
}

function exportData() {
    const data = JSON.stringify(store.state);
    const blob = new Blob([data], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meditation_data.json';
    a.click();
    URL.revokeObjectURL(url);
}

function importData(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedState = JSON.parse(e.target.result);
                store.setState(importedState);
                showToast('Data imported successfully.');
            } catch (error) {
                showToast('Failed to import data. Please check the file and try again.');
            }
        };
        reader.readAsText(file);
    }
}

function checkOnlineStatus() {
    const onlineIndicator = document.getElementById('onlineIndicator');
    if (navigator.onLine) {
        onlineIndicator.textContent = 'Online';
        onlineIndicator.classList.add('online');
        onlineIndicator.classList.remove('offline');
    } else {
        onlineIndicator.textContent = 'Offline';
        onlineIndicator.classList.add('offline');
        onlineIndicator.classList.remove('online');
    }
}

// Initialize application
const store = new MeditationStore();

document.addEventListener('DOMContentLoaded', () => {
    // Event listeners setup
    document.getElementById('embedMedia').addEventListener('click', handleEmbedMedia);
    document.getElementById('themeToggle').addEventListener('click', () => store.toggleTheme());
    document.getElementById('giveFeedback').addEventListener('click', () => openModal('feedbackModal'));
    document.getElementById('addPastSession').addEventListener('click', () => openModal('pastSessionModal'));
    document.getElementById('createMandal').addEventListener('click', handleCreateMandal);
    document.getElementById('sortByDate').addEventListener('click', () => {
        store.toggleSortOrder();
        displaySessionHistory(store.state);
    });
    document.getElementById('submitFeedback').addEventListener('click', handleSubmitFeedback);
    document.getElementById('pastSessionForm').addEventListener('submit', handleAddPastSession);
    document.getElementById('searchInput').addEventListener('input', handleSearch);
    document.getElementById('startSession').addEventListener('click', handleStartSession);
    document.getElementById('stopSession').addEventListener('click', handleStopSession);
    document.getElementById('exportData').addEventListener('click', exportData);
    document.getElementById('importData').addEventListener('change', importData);

    const userNameElement = document.getElementById('userName');
    userNameElement.textContent = store.state.userName;
    userNameElement.addEventListener('blur', (e) => {
        const newName = e.target.textContent.trim();
        if (newName) {
            store.setUserName(sanitizeHTML(newName));
            showToast('Name updated successfully.');
        } else {
            e.target.textContent = store.state.userName;
            showToast('Name cannot be empty.');
        }
    });

    if (store.state.activeMandal) {
        document.getElementById('activeMandalInfo').style.display = 'block';
        document.getElementById('sessionHistory').style.display = 'block';
        document.getElementById('mandalCreation').style.display = 'none';
    }

    // Observer setup
    store.addObserver({
        update: function(state) {
            updateMeditationInfo(state);
            updateMeditationVisualization(state);
            updateDashboard(state);
            displaySessionHistory(state);
            updateTimerControls(state.timerRunning);
            updateTimerDisplay(state.timerSeconds);
            updatePlaylistUI(state.playlists);
        }
    });

    // Initial UI update
    store.notifyObservers();

    // Set up online/offline event listeners
    window.addEventListener('online', checkOnlineStatus);
    window.addEventListener('offline', checkOnlineStatus);
    checkOnlineStatus(); // Initial check

    // Improve accessibility
    improveAccessibility();
});

// Close modals when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        closeModal(event.target.id);
    }
};

// Close modals when pressing Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(modal => {
            if (modal.style.display === 'block') {
                closeModal(modal.id);
            }
        });
    }
});

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
            case 's':
                e.preventDefault();
                if (store.state.timerRunning) {
                    handleStopSession();
                } else {
                    handleStartSession();
                }
                break;
            case 'f':
                e.preventDefault();
                document.getElementById('searchInput').focus();
                break;
            case 'n':
                e.preventDefault();
                openModal('pastSessionModal');
                break;
        }
    }
});

// Cleanup function
window.addEventListener('beforeunload', (event) => {
    store.cleanup();
    if (store.state.timerRunning) {
        event.preventDefault();
        event.returnValue = 'You have an active meditation session. Are you sure you want to leave?';
    }
});

// Accessibility improvements
function improveAccessibility() {
    // Add labels to inputs
    const inputs = document.querySelectorAll('input:not([aria-label])');
    inputs.forEach(input => {
        const id = input.id || `input-${Math.random().toString(36).substr(2, 9)}`;
        input.id = id;
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = input.placeholder || 'Input field';
        input.parentNode.insertBefore(label, input);
    });

    // Improve color contrast
    document.documentElement.style.setProperty('--primary-color', '#0056b3');
    document.documentElement.style.setProperty('--secondary-color', '#28a745');

    // Improve focus styles
    const style = document.createElement('style');
    style.textContent = `
        *:focus {
            outline: 3px solid #007bff;
            outline-offset: 2px;
        }
    `;
    document.head.appendChild(style);
}

// Confetti effect for milestones
function showConfetti() {
    const confettiCount = 200;
    const confettiColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];

    for (let i = 0; i < confettiCount; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = `${Math.random() * 100}vw`;
        confetti.style.animationDuration = `${Math.random() * 3 + 2}s`;
        confetti.style.backgroundColor = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        document.body.appendChild(confetti);

        setTimeout(() => {
            confetti.remove();
        }, 5000);
    }
}

// Add this to the stylesheet
const confettiStyle = document.createElement('style');
confettiStyle.textContent = `
    .confetti {
        position: fixed;
        width: 10px;
        height: 10px;
        background-color: #f00;
        top: -10px;
        animation: fall linear forwards;
    }
    @keyframes fall {
        to {
            transform: translateY(100vh) rotate(720deg);
        }
    }
`;
document.head.appendChild(confettiStyle);

// Make store globally accessible (for debugging purposes)
window.store = store;
//concludes rewrite

document.addEventListener('DOMContentLoaded', () => {
    // Check if all necessary elements exist
    const requiredElements = [
        'meditationInfo',
        'meditationVisualization',
        'dashboard',
        'historyContent',
        'timer',
        'startSession',
        'stopSession',
        'youtubePlaylist',
        'soundcloudPlaylist'
    ];

    const missingElements = requiredElements.filter(id => !document.getElementById(id));

    if (missingElements.length > 0) {
        console.error('Missing DOM elements:', missingElements);
        alert('Some required elements are missing from the page. Please check the console for details.');
        return;
    }

    // Proceed with initialization
    store = new MeditationStore();

    // Event listeners setup
    // ... (rest of the event listener setup code)

    // Observer setup
    store.addObserver({
        update: function(state) {
            updateMeditationInfo(state);
            updateMeditationVisualization(state);
            updateDashboard(state);
            displaySessionHistory(state);
            updateTimerControls(state.timerRunning);
            updateTimerDisplay(state.timerSeconds);
            updatePlaylistUI(state.playlists);
        }
    });

    // Initial UI update
    store.notifyObservers();

    // ... (rest of the initialization code)
});
