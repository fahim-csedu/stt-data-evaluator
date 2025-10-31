class LoginManager {
    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.checkExistingSession();
    }
    
    initializeElements() {
        this.loginForm = document.getElementById('loginForm');
        this.usernameInput = document.getElementById('username');
        this.passwordInput = document.getElementById('password');
        this.loginBtn = document.getElementById('loginBtn');
        this.errorMessage = document.getElementById('errorMessage');
    }
    
    bindEvents() {
        this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }
    
    checkExistingSession() {
        const sessionId = localStorage.getItem('audioFileBrowserSession');
        if (sessionId) {
            // Try to access a protected endpoint to verify session
            fetch('/api/browse', {
                headers: {
                    'x-session-id': sessionId
                }
            })
            .then(response => {
                if (response.ok) {
                    // Session is valid, redirect to main app
                    window.location.href = '/';
                }
            })
            .catch(() => {
                // Session invalid, remove it
                localStorage.removeItem('audioFileBrowserSession');
                localStorage.removeItem('audioFileBrowserUsername');
            });
        }
    }
    
    async handleLogin(e) {
        e.preventDefault();
        
        const username = this.usernameInput.value.trim();
        const password = this.passwordInput.value.trim();
        
        if (!username || !password) {
            this.showError('Please enter both username and password');
            return;
        }
        
        this.loginBtn.disabled = true;
        this.loginBtn.textContent = 'Logging in...';
        this.hideError();
        
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Store session info
                localStorage.setItem('audioFileBrowserSession', data.sessionId);
                localStorage.setItem('audioFileBrowserUsername', data.username);
                
                // Redirect to main app
                window.location.href = '/';
            } else {
                this.showError(data.error || 'Login failed');
            }
        } catch (error) {
            this.showError('Network error. Please try again.');
        } finally {
            this.loginBtn.disabled = false;
            this.loginBtn.textContent = 'Login';
        }
    }
    
    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.style.display = 'block';
    }
    
    hideError() {
        this.errorMessage.style.display = 'none';
    }
}


// Initialize login manager when page loads
document.addEventListener('DOMContentLoaded', () => {
    new LoginManager();
});