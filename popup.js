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

    // NEW: Get references to statistics display elements and clear button
    const totalDiscardedCountSpan = document.getElementById('totalDiscardedCount');
    const totalClosedCountSpan = document.getElementById('totalClosedCount');
    const clearStatsButton = document.getElementById('clearStatsButton');


    // Load saved settings from storage and display them in the popup.
    // Using async/await for consistency and cleaner error handling.
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
        }
    };

    // Save the new settings to storage.
    // Using async/await for consistency and cleaner error handling.
    const saveSettings = async () => {
        const tabLimit = parseInt(tabLimitInput.value, 10);
        const inactivityTimer = parseInt(inactivityTimerInput.value, 10);
        const whitelist = whitelistInput.value.split('\n').map(s => s.trim()).filter(Boolean);
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
            saveStatus.textContent = 'Settings saved!';
            setTimeout(() => {
                saveStatus.textContent = '';
            }, 3000);
        } catch (error) {
            console.error("Error saving settings:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
        }
    };

    // Load and render recently handled tab history.
    // Using async/await for consistency and cleaner error handling.
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
                // IMPORTANT FIX: Add a defensive check for 'tab' object validity
                if (!tab || typeof tab !== 'object' || (!tab.title && !tab.url)) {
                    console.warn("Skipping malformed history entry:", tab);
                    return; // Skip this entry if it's not a valid object or missing crucial data
                }

                const listItem = document.createElement('li');
                listItem.style.marginBottom = '10px';

                // Use tab.title or tab.url, ensuring fallbacks
                const title = tab.title || tab.url || 'Untitled Tab';
                const url = tab.url || 'about:blank'; // Ensure url is not empty for href

                listItem.innerHTML = `
                    <div>
                        <img src="${tab.favIconUrl || ''}" alt="" style="width:16px;height:16px;vertical-align:middle;margin-right:6px;">
                        <strong style="font-size: 14px;">${title}</strong>
                    </div>
                    <div style="font-size: 12px; color: #555; word-break: break-all;"><a href="${url}" target="_blank" style="color: #007bff; text-decoration: none;">${url}</a></div>
                    <button style="margin-top:4px;padding:4px 8px;font-size:12px;" class="reopen-btn" data-url="${url}">Reopen</button>
                `;
                historyList.appendChild(listItem);
            });

            // Attach event listeners for reopen buttons
            document.querySelectorAll('.reopen-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const url = btn.getAttribute('data-url');
                    chrome.tabs.create({ url });
                });
            });
        } catch (error) {
            console.error("Error loading closed tabs history:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
        }
    };

    // NEW: Function to load and display tab management statistics
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
        }
    };

    // NEW: Function to clear tab management statistics
    const clearStats = async () => {
        try {
            await chrome.storage.local.set({ totalDiscardedCount: 0, totalClosedCount: 0 });
            loadStats(); // Reload stats to update the display
            console.log("Tab management statistics cleared.");
        } catch (error) {
            console.error("Error clearing statistics:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
        }
    };


    // --- Event Listeners ---
    saveButton.addEventListener('click', saveSettings);
    clearHistoryButton.addEventListener('click', async () => {
        try {
            await chrome.storage.local.remove('closedTabsHistory');
            historyList.innerHTML = '<li style="color: #777;">History cleared.</li>';
            console.log("Closed tabs history cleared.");
        } catch (error) {
            console.error("Error clearing history:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
        }
    });
    // NEW: Add event listener for the clear stats button
    clearStatsButton.addEventListener('click', clearStats);


    // --- Initial Load ---
    loadSettings();
    loadClosedTabsHistory();
    loadStats(); // NEW: Load statistics on popup open
});