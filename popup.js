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
        }
    };

    // Save the new settings to storage.
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

                // Pass the original tab ID if it exists and was a suspended tab
                // This will be used to try and reactivate the original tab
                const originalTabId = tab.id || null; // Capture the original tab ID

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

            // Attach event listeners for reopen buttons
            document.querySelectorAll('.reopen-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const url = btn.getAttribute('data-url');
                    const originalTabId = parseInt(btn.getAttribute('data-tab-id'), 10); // Get the original tab ID

                    let tabReopened = false;

                    if (!isNaN(originalTabId)) { // If we have a valid original tab ID
                        try {
                            // Try to find the specific tab by its ID
                            const tabs = await chrome.tabs.query({ id: originalTabId, discarded: true });
                            if (tabs.length > 0) {
                                // Found the discarded tab, activate and reload it
                                await chrome.tabs.update(originalTabId, { active: true });
                                // Optionally, reload the tab if its content wasn't fully restored
                                // await chrome.tabs.reload(originalTabId); // Uncomment if just activating isn't enough
                                console.log(`Reactivated and focused discarded tab ID: ${originalTabId}`);
                                tabReopened = true;
                            }
                        } catch (error) {
                            console.warn(`Could not find or reactivate tab ID ${originalTabId}. It might have been truly closed or an error occurred:`, error);
                            // Fall through to creating a new tab if there's an error finding it
                        }
                    }

                    if (!tabReopened) {
                        // If the original discarded tab wasn't found or reactivated,
                        // try to find any existing tab with the same URL (discarded or not)
                        const existingTabs = await chrome.tabs.query({ url: url });
                        if (existingTabs.length > 0) {
                            // Activate the first found tab with the same URL
                            await chrome.tabs.update(existingTabs[0].id, { active: true });
                            console.log(`Activated existing tab with URL: ${url}`);
                        } else {
                            // If no existing tab with the URL is found, create a new one
                            await chrome.tabs.create({ url: url });
                            console.log(`Created new tab for URL: ${url}`);
                        }
                    }
                });
            });
        } catch (error) {
            console.error("Error loading closed tabs history:", error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
        }
    };

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
        }
    };

    // Function to clear tab management statistics
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
    // Add event listener for the clear stats button
    clearStatsButton.addEventListener('click', clearStats);

    // --- Initial Load ---
    loadSettings();
    loadClosedTabsHistory();
    loadStats();
    loadCurrentTabCount(); // Load current tab count on popup open
});