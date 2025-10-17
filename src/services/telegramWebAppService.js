// Telegram WebApp Integration Service
class TelegramWebAppService {
  constructor() {
    this.isTelegramWebApp = false;
    this.telegramUser = null;
    this.initData = null;
  }

  // Initialize Telegram WebApp
  async initialize() {
    try {
      // Check if running in Telegram WebApp
      if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
        this.isTelegramWebApp = true;
        this.telegramUser = window.Telegram.WebApp.initDataUnsafe?.user;
        this.initData = window.Telegram.WebApp.initData;

        // Configure Telegram WebApp
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();

        // Set theme
        if (window.Telegram.WebApp.colorScheme === 'dark') {
          document.body.classList.add('dark-theme');
        }

        // Handle theme changes
        window.Telegram.WebApp.onEvent('themeChanged', () => {
          if (window.Telegram.WebApp.colorScheme === 'dark') {
            document.body.classList.add('dark-theme');
          } else {
            document.body.classList.remove('dark-theme');
          }
        });

        // Handle back button
        window.Telegram.WebApp.onEvent('backButtonClicked', () => {
          window.history.back();
        });

        // Handle main button
        window.Telegram.WebApp.onEvent('mainButtonClicked', () => {
          // Handle main button click
          this.handleMainButtonClick();
        });

        console.log('Telegram WebApp initialized:', this.telegramUser);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error initializing Telegram WebApp:', error);
      return false;
    }
  }

  // Get user data from backend
  async getUserData() {
    try {
      if (!this.isTelegramWebApp || !this.telegramUser) {
        throw new Error('Not running in Telegram WebApp');
      }

      const response = await fetch('/api/telegram-webapp/webapp-init', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          initData: this.initData,
          user: this.telegramUser,
          referralCode: this.getReferralCode()
        })
      });

      const result = await response.json();

      if (result.success) {
        return result.data;
      } else {
        throw new Error(result.error.message);
      }
    } catch (error) {
      console.error('Error getting user data:', error);
      throw error;
    }
  }

  // Sync user data with backend
  async syncUserData(userData) {
    try {
      if (!this.isTelegramWebApp || !this.telegramUser) {
        throw new Error('Not running in Telegram WebApp');
      }

      const response = await fetch('/api/telegram-webapp/sync-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          telegramId: this.telegramUser.id,
          userData
        })
      });

      const result = await response.json();

      if (result.success) {
        return result.data;
      } else {
        throw new Error(result.error.message);
      }
    } catch (error) {
      console.error('Error syncing user data:', error);
      throw error;
    }
  }

  // Get referral code from URL
  getReferralCode() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('ref') || urlParams.get('referral');
    } catch (error) {
      return null;
    }
  }

  // Show main button
  showMainButton(text, onClick) {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.MainButton.setText(text);
      window.Telegram.WebApp.MainButton.show();
      this.mainButtonClickHandler = onClick;
    }
  }

  // Hide main button
  hideMainButton() {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.MainButton.hide();
    }
  }

  // Show back button
  showBackButton() {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.BackButton.show();
    }
  }

  // Hide back button
  hideBackButton() {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.BackButton.hide();
    }
  }

  // Show alert
  showAlert(message) {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.showAlert(message);
    } else {
      alert(message);
    }
  }

  // Show confirm
  showConfirm(message, callback) {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.showConfirm(message, callback);
    } else {
      const result = confirm(message);
      callback(result);
    }
  }

  // Show popup
  showPopup(options, callback) {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.showPopup(options, callback);
    } else {
      // Fallback for non-Telegram environment
      const result = prompt(options.message || 'Enter value:');
      callback(result);
    }
  }

  // Haptic feedback
  hapticFeedback(type = 'light') {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.HapticFeedback.impactOccurred(type);
    }
  }

  // Close WebApp
  close() {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.close();
    }
  }

  // Handle main button click
  handleMainButtonClick() {
    if (this.mainButtonClickHandler) {
      this.mainButtonClickHandler();
    }
  }

  // Get Telegram user info
  getTelegramUser() {
    return this.telegramUser;
  }

  // Check if running in Telegram WebApp
  isRunningInTelegram() {
    return this.isTelegramWebApp;
  }

  // Get WebApp version
  getVersion() {
    if (this.isTelegramWebApp) {
      return window.Telegram.WebApp.version;
    }
    return null;
  }

  // Get platform
  getPlatform() {
    if (this.isTelegramWebApp) {
      return window.Telegram.WebApp.platform;
    }
    return null;
  }

  // Get color scheme
  getColorScheme() {
    if (this.isTelegramWebApp) {
      return window.Telegram.WebApp.colorScheme;
    }
    return 'light';
  }

  // Get theme params
  getThemeParams() {
    if (this.isTelegramWebApp) {
      return window.Telegram.WebApp.themeParams;
    }
    return {};
  }

  // Set header color
  setHeaderColor(color) {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.headerColor = color;
    }
  }

  // Set background color
  setBackgroundColor(color) {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.backgroundColor = color;
    }
  }

  // Enable closing confirmation
  enableClosingConfirmation() {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.enableClosingConfirmation();
    }
  }

  // Disable closing confirmation
  disableClosingConfirmation() {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.disableClosingConfirmation();
    }
  }

  // Send data to bot
  sendData(data) {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.sendData(JSON.stringify(data));
    }
  }

  // Open link
  openLink(url, options = {}) {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.openLink(url, options);
    } else {
      window.open(url, '_blank');
    }
  }

  // Open telegram link
  openTelegramLink(url) {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  }

  // Open invoice
  openInvoice(url, callback) {
    if (this.isTelegramWebApp) {
      window.Telegram.WebApp.openInvoice(url, callback);
    } else {
      // Fallback for non-Telegram environment
      window.open(url, '_blank');
      callback(true);
    }
  }
}

// Create global instance
const telegramWebApp = new TelegramWebAppService();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = telegramWebApp;
} else if (typeof window !== 'undefined') {
  window.telegramWebApp = telegramWebApp;
}
