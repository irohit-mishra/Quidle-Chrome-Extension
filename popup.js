document.addEventListener('DOMContentLoaded', () => {
    // Get references to input elements and buttons
    const extensionEnabledCheckbox = document.getElementById('extensionEnabled');
    const tabLimitInput = document.getElementById('tabLimit');
    const inactivityTimerInput = document.getElementById('inactivityTimer');
    const whitelistInput = document.getElementById('whitelist');
    const actionTypeInput = document.getElementById('actionType');
    const saveButton = document.getElementById('saveButton');
    const saveStatus = document.getElementById('save-status');
    const clearHistoryButton = document.getElementById('clearHistoryButton');
    const historyList = document.getElementById('historyList');

    // Get references to statistics display elements and clear button
    const totalDiscardedCountSpan = document.getElementById('totalDiscardedCount');
    const totalClosedCountSpan = document.getElementById('totalClosedCount');
    const clearStatsButton = document.getElementById('clearStatsButton');

    // Get reference to the current tab count display element
    const currentTabCountSpan = document.getElementById('currentTabCount');

    // Helper: Show status message
    function showStatus(msg, isError = false) {
        saveStatus.textContent = msg;
        saveStatus.style.color = isError ? 'red' : 'green';
        setTimeout(() => { saveStatus.textContent = ''; }, 3000);
    }

    // Load saved settings from storage and display them in the popup.
    const loadSettings = async () => {
        try {
            const result = await chrome.storage.local.get(['tabLimit', 'inactivityTimer', 'whitelist', 'extensionEnabled', 'actionType']);
            tabLimitInput.value = result.tabLimit || 15;
            inactivityTimerInput.value = result.inactivityTimer || 60;
            whitelistInput.value = result.whitelist ? result.whitelist.join('\n') : '';
            extensionEnabledCheckbox.checked = result.extensionEnabled !== false; // default to true
            actionTypeInput.value = result.actionType || 'suspend';
        } catch (error) {
            console.error("Error loading settings:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
            showStatus("Failed to load settings.", true);
        }
    };

    // Save the new settings to storage.
    const saveSettings = async () => {
        // Input validation
        const tabLimit = parseInt(tabLimitInput.value, 10);
        const inactivityTimer = parseInt(inactivityTimerInput.value, 10);

        if (isNaN(tabLimit) || tabLimit < 1) {
            showStatus("Tab limit must be a positive integer.", true);
            return;
        }
        if (isNaN(inactivityTimer) || inactivityTimer < 1) {
            showStatus("Inactivity timer must be a positive integer.", true);
            return;
        }

        // Whitelist: support both comma and newline separation
        let whitelist = whitelistInput.value
            .split(/[\n,]+/)
            .map(s => s.trim())
            .filter(Boolean);

        const extensionEnabled = extensionEnabledCheckbox.checked;
        const actionType = actionTypeInput.value;

        try {
            await chrome.storage.local.set({
                tabLimit,
                inactivityTimer,
                whitelist,
                extensionEnabled,
                actionType
            });
            showStatus('Settings saved!');
            loadSettings(); // Reload to sync UI
        } catch (error) {
            console.error("Error saving settings:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
            showStatus("Failed to save settings.", true);
        }
    };

    // Load and render recently handled tab history.
    const loadClosedTabsHistory = async () => {
        try {
            const result = await chrome.storage.local.get(['closedTabsHistory']);
            const history = result.closedTabsHistory || [];

            if (history.length === 0) {
                historyList.innerHTML = '<li style="color: #777;">No recently handled tabs.</li>';
                return;
            }

            historyList.innerHTML = ''; // Clear existing list items before re-rendering

            history.forEach(tab => {
                if (!tab || typeof tab !== 'object' || (!tab.title && !tab.url)) {
                    console.warn("Skipping malformed history entry:", tab);
                    return;
                }

                const listItem = document.createElement('li');
                listItem.style.marginBottom = '10px';

                const title = tab.title || tab.url || 'Untitled Tab';
                const url = tab.url || 'about:blank';
                const originalTabId = tab.id || '';

                listItem.innerHTML = `
                    <div>
                        <img src="${tab.favIconUrl || ''}" alt="" style="width:16px;height:16px;vertical-align:middle;margin-right:6px;">
                        <strong style="font-size: 14px;">${title}</strong>
                    </div>
                    <div style="font-size: 12px; color: #555; word-break: break-all;"><a href="${url}" target="_blank" style="color: #007bff; text-decoration: none;">${url}</a></div>
                    <button style="margin-top:4px;padding:4px 8px;font-size:12px;" class="reopen-btn" data-url="${url}" data-tab-id="${originalTabId}">Reopen</button>
                `;
                historyList.appendChild(listItem);
            });
        } catch (error) {
            console.error("Error loading closed tabs history:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
            showStatus("Failed to load history.", true);
        }
    };

    // Event delegation for reopen buttons
    historyList.addEventListener('click', async (event) => {
        if (event.target.classList.contains('reopen-btn')) {
            const btn = event.target;
            const url = btn.getAttribute('data-url');
            const originalTabId = parseInt(btn.getAttribute('data-tab-id'), 10);
            let tabReopened = false;

            if (!isNaN(originalTabId)) {
                try {
                    const tab = await chrome.tabs.get(originalTabId);
                    if (tab && tab.discarded) {
                        await chrome.tabs.update(originalTabId, { active: true });
                        tabReopened = true;
                        showStatus("Tab reactivated!");
                    }
                } catch (error) {
                    // Tab not found or not discarded, fall through
                }
            }

            if (!tabReopened) {
                // Try to find any existing tab with the same URL
                const existingTabs = await chrome.tabs.query({ url: url });
                if (existingTabs.length > 0) {
                    await chrome.tabs.update(existingTabs[0].id, { active: true });
                    showStatus("Existing tab activated!");
                } else {
                    await chrome.tabs.create({ url: url });
                    showStatus("New tab created!");
                }
            }
        }
    });

    // Function to load and display tab management statistics
    const loadStats = async () => {
        try {
            const result = await chrome.storage.local.get(['totalDiscardedCount', 'totalClosedCount']);
            totalDiscardedCountSpan.textContent = result.totalDiscardedCount || 0;
            totalClosedCountSpan.textContent = result.totalClosedCount || 0;
        } catch (error) {
            console.error("Error loading statistics:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
            showStatus("Failed to load stats.", true);
        }
    };

    // Function to clear tab management statistics
    const clearStats = async () => {
        if (!confirm("Are you sure you want to clear statistics?")) return;
        clearStatsButton.disabled = true;
        try {
            await chrome.storage.local.set({ totalDiscardedCount: 0, totalClosedCount: 0 });
            loadStats(); // Reload stats to update the display
            showStatus("Statistics cleared!");
        } catch (error) {
            console.error("Error clearing statistics:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
            showStatus("Failed to clear stats.", true);
        } finally {
            clearStatsButton.disabled = false;
        }
    };

    // Function to get and display the current number of open tabs
    const loadCurrentTabCount = async () => {
        try {
            const allTabs = await chrome.tabs.query({});
            currentTabCountSpan.textContent = allTabs.length;
        } catch (error) {
            console.error("Error loading current tab count:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
            showStatus("Failed to load tab count.", true);
        }
    };

    // --- Event Listeners ---
    saveButton.addEventListener('click', saveSettings);

    clearHistoryButton.addEventListener('click', async () => {
        if (!confirm("Are you sure you want to clear tab history?")) return;
        clearHistoryButton.disabled = true;
        try {
            await chrome.storage.local.remove('closedTabsHistory');
            historyList.innerHTML = '<li style="color: #777;">History cleared.</li>';
            showStatus("History cleared!");
        } catch (error) {
            console.error("Error clearing history:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
            showStatus("Failed to clear history.", true);
        } finally {
            clearHistoryButton.disabled = false;
        }
    });

    clearStatsButton.addEventListener('click', clearStats);

    // --- Initial Load ---
    loadSettings();
    loadClosedTabsHistory();
    loadStats();
    loadCurrentTabCount();
});