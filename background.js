// DEFAULT_SETTINGS: Defines the initial configuration for the extension.
// These values are used when no settings are found in Chrome's local storage.
const DEFAULT_SETTINGS = {
    tabLimit: 15,          // Maximum number of tabs allowed before closure/suspension logic activates.
    inactivityTimer: 60,   // Time in minutes after which an inactive tab becomes eligible.
    // Whitelist: Domains to exclude from management.
    // Ensure these are hostnames (e.g., 'youtube.com', not 'https://www.youtube.com').
    // The current logic checks if the tab's hostname *includes* any whitelisted domain (e.g., 'youtube.com'),
    // meaning 'sub.example.com' will match 'example.com' in the whitelist.
    whitelist: ['youtube.com', 'docs.google.com', 'mail.google.com', 'drive.google.com'],
    extensionEnabled: true, // Master switch to enable/disable the extension's core functionality.
    actionType: 'suspend', // 'suspend' to discard tabs, 'close' to close them permanently.
    // NEW: Counters for tracking tabs managed by the extension
    totalDiscardedCount: 0, // Cumulative count of tabs discarded by the extension
    totalClosedCount: 0     // Cumulative count of tabs closed by the extension
};

// --- Timestamp Management ---

/**
 * Updates the last active timestamp for a given tab.
 * This function is crucial for tracking tab inactivity.
 * @param {number} tabId - The ID of the tab to update.
 */
async function updateTabTimestamp(tabId) {
    // Ignore invalid tab IDs.
    if (tabId === chrome.tabs.TAB_ID_NONE) {
        return;
    }

    try {
        // Retrieve current tab timestamps from local storage.
        const result = await chrome.storage.local.get(['tabTimestamps']);
        const timestamps = result.tabTimestamps || {}; // Use existing timestamps or an empty object.

        // Update the timestamp for the specific tab ID to the current time.
        timestamps[tabId] = Date.now();

        // Save the updated timestamps back to local storage.
        await chrome.storage.local.set({ tabTimestamps: timestamps });
        // console.log(`Timestamp updated for tab ${tabId}: ${new Date(timestamps[tabId]).toLocaleTimeString()}`);
    } catch (error) {
        console.error(`Error updating timestamp for tab ${tabId}:`, error);
        // It's good practice to log chrome.runtime.lastError explicitly for debugging
        if (chrome.runtime.lastError) {
            console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
        }
    }
}

/**
 * Removes a tab's data (timestamp) from storage when the tab is closed.
 * This prevents accumulation of data for non-existent tabs.
 * @param {number} tabId - The ID of the tab to remove.
 */
async function removeTabData(tabId) {
    try {
        // Retrieve current tab timestamps.
        const result = await chrome.storage.local.get(['tabTimestamps']);
        const timestamps = result.tabTimestamps || {};

        // Delete the entry for the specified tab ID.
        delete timestamps[tabId];

        // Save the modified timestamps back to local storage.
        await chrome.storage.local.set({ tabTimestamps: timestamps });
        // console.log(`Removed tab data for tab ${tabId}`);
    } catch (error) {
        console.error(`Error removing tab data for tab ${tabId}:`, error);
        if (chrome.runtime.lastError) {
            console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
        }
    }
}

// --- Core Logic ---

/**
 * Checks all open tabs and takes action (suspend/close) on inactive ones
 * if the tab count exceeds the limit.
 */
async function checkAndCloseTabs() {
    console.log('Quidle: Checking tabs...');

    // Retrieve all user settings from local storage.
    const settings = await chrome.storage.local.get([
        'tabLimit',
        'inactivityTimer',
        'whitelist',
        'extensionEnabled',
        'actionType',
        'totalDiscardedCount',
        'totalClosedCount'
    ]);

    // Destructure settings, providing default values if not found in storage.
    const {
        tabLimit = DEFAULT_SETTINGS.tabLimit,
        inactivityTimer = DEFAULT_SETTINGS.inactivityTimer,
        whitelist = DEFAULT_SETTINGS.whitelist,
        extensionEnabled = DEFAULT_SETTINGS.extensionEnabled,
        actionType = DEFAULT_SETTINGS.actionType,
        totalDiscardedCount = DEFAULT_SETTINGS.totalDiscardedCount,
        totalClosedCount = DEFAULT_SETTINGS.totalClosedCount
    } = settings;

    // If the extension is disabled, log a message and exit.
    if (!extensionEnabled) {
        console.log('Quidle is disabled.');
        return;
    }

    // Get all currently open tabs.
    const allTabs = await chrome.tabs.query({});
    // If the total number of tabs is within the limit, no action is needed.
    if (allTabs.length <= tabLimit) {
        console.log(`Tab count (${allTabs.length}) is within limit (${tabLimit}). No tabs to manage.`);
        return;
    }

    // Retrieve tab timestamps and get the current time.
    const { tabTimestamps = {} } = await chrome.storage.local.get(['tabTimestamps']);
    const now = Date.now();
    // Calculate the inactivity threshold in milliseconds.
    const inactivityThreshold = inactivityTimer * 60 * 1000; // minutes to milliseconds

    // Filter tabs that are eligible for closure/suspension.
    const eligibleTabs = allTabs.filter(tab => {
        // PRIMARY FIX (already present in last code, but crucial): Exclude tabs that are already discarded.
        if (tab.discarded) {
            return false;
        }
        // Exclude active, pinned, or audible tabs.
        if (tab.active || tab.pinned || tab.audible) {
            return false;
        }

        // Exclude tabs whose URLs match any domain in the whitelist.
        if (tab.url) {
            try {
                const urlObj = new URL(tab.url);
                // Check if the tab's hostname (e.g., 'www.youtube.com') includes any whitelisted domain (e.g., 'youtube.com').
                // This covers subdomains.
                if (whitelist.some(domain => urlObj.hostname.includes(domain))) {
                    return false;
                }
            } catch (e) {
                // Handle invalid URLs gracefully (e.g., chrome://, about:blank, etc.)
                // These typically don't have a hostname and won't match the whitelist anyway.
                console.warn(`Could not parse URL for tab ${tab.id}: ${tab.url}`, e);
                return false; // Treat as not eligible if URL cannot be parsed
            }
        } else {
            // If tab.url is null or undefined (e.g., new tab page before navigation), skip.
            return false;
        }

        // Get the last accessed timestamp for the tab, defaulting to now if not found.
        const lastAccessed = tabTimestamps[tab.id] || now;
        // Check if the tab has been inactive for longer than the threshold.
        return (now - lastAccessed) > inactivityThreshold;
    });

    // If no eligible tabs are found, exit.
    if (eligibleTabs.length === 0) {
        console.log('No eligible inactive tabs to manage.');
        return;
    }

    // Sort eligible tabs by their last accessed timestamp to find the oldest one.
    // The tab with the smallest timestamp is the oldest inactive tab.
    const tabToManage = eligibleTabs.reduce((oldest, current) => {
        const oldestTimestamp = tabTimestamps[oldest.id] || now;
        const currentTimestamp = tabTimestamps[current.id] || now;
        return currentTimestamp < oldestTimestamp ? current : oldest;
    });

    // If a tab to close/suspend is identified.
    if (tabToManage) {
        console.log(`Quidle: Handling tab: ${tabToManage.title || tabToManage.url} (ID: ${tabToManage.id})`);

        try {
            // Perform the chosen action (close or suspend/discard) on the tab.
            if (actionType === 'close') {
                await chrome.tabs.remove(tabToManage.id);
                // Increment totalClosedCount
                await chrome.storage.local.set({ totalClosedCount: totalClosedCount + 1 });
                console.log(`Closed tab: "${tabToManage.title || tabToManage.url}"`);

                // Add to history
                const closedTabData = {
                    url: tabToManage.url || 'about:blank',
                    title: tabToManage.title || 'Untitled',
                    favIconUrl: tabToManage.favIconUrl || '',
                    closedAt: Date.now()
                };
                const { closedTabsHistory = [] } = await chrome.storage.local.get('closedTabsHistory');

                // NEW DEFENSIVE CHECK FOR HISTORY: Prevent duplicate history entries for recently closed tabs
                const lastEntry = closedTabsHistory.length > 0 ? closedTabsHistory[0] : null;
                // Check if the last entry is for the same URL and was added very recently (e.g., within 5 seconds)
                if (lastEntry && lastEntry.url === closedTabData.url && lastEntry.closedAt && (Date.now() - lastEntry.closedAt < 5000)) {
                    console.warn(`Skipping duplicate history entry for recently closed tab: ${closedTabData.title}`);
                } else {
                    closedTabsHistory.unshift(closedTabData);
                    await chrome.storage.local.set({ closedTabsHistory: closedTabsHistory.slice(0, 10) });
                    console.log(`Added "${closedTabData.title}" to closed tabs history.`);
                }

            } else { // 'suspend' (discard)
                await chrome.tabs.discard(tabToManage.id);
                // Increment totalDiscardedCount
                await chrome.storage.local.set({ totalDiscardedCount: totalDiscardedCount + 1 });
                console.log(`Suspended tab: "${tabToManage.title || tabToManage.url}"`);

                // Store the tab ID along with other data for history (for suspended tabs)
                const suspendedTabData = {
                    id: tabToManage.id, // CRITICAL ADDITION: Store the tab's ID
                    url: tabToManage.url || 'about:blank',
                    title: tabToManage.title || 'Untitled',
                    favIconUrl: tabToManage.favIconUrl || '',
                    closedAt: Date.now()
                };
                // Retrieve existing history
                const { closedTabsHistory: currentHistory = [] } = await chrome.storage.local.get('closedTabsHistory');

                // NEW DEFENSIVE CHECK FOR HISTORY: Prevent duplicate history entries for recently suspended tabs
                const lastEntry = currentHistory.length > 0 ? currentHistory[0] : null;
                // Check if the last entry is for the same tab ID (more reliable for suspended tabs)
                if (lastEntry && lastEntry.id === suspendedTabData.id) {
                    console.warn(`Skipping duplicate history entry for already suspended tab ID: ${suspendedTabData.id}`);
                } else {
                    currentHistory.unshift(suspendedTabData);
                    await chrome.storage.local.set({ closedTabsHistory: currentHistory.slice(0, 10) });
                    console.log(`Added "${suspendedTabData.title}" to suspended tabs history.`);
                }
            }
        } catch (error) {
            console.error(`Error handling tab ${tabToManage.id}:`, error);
            if (chrome.runtime.lastError) {
                console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
            }
        }
    }
}

// --- Event & Alarm Listeners ---

// onInstalled: Fired when the extension is first installed, updated to a new version,
// or Chrome is updated.
chrome.runtime.onInstalled.addListener(async () => {
    console.log('Quidle: Extension installed or updated.');
    try {
        // Retrieve current settings to check if they exist.
        const currentSettings = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
        let settingsToSet = {};

        // Apply default settings only if they don't exist in storage.
        for (const key in DEFAULT_SETTINGS) {
            if (currentSettings[key] === undefined) {
                settingsToSet[key] = DEFAULT_SETTINGS[key];
            }
        }

        if (Object.keys(settingsToSet).length > 0) {
            await chrome.storage.local.set(settingsToSet);
            console.log('Default settings applied for missing values.');
        } else {
            console.log('All settings already present in storage.');
        }

        // Create an alarm to periodically check and close/suspend tabs.
        // It triggers after a 1-minute delay and then every 1 minute.
        chrome.alarms.create('checkTabsAlarm', {
            delayInMinutes: 1,
            periodInMinutes: 1
        });
        console.log('Alarm "checkTabsAlarm" created.');

        // Initialize timestamps for all currently open tabs on installation.
        const tabs = await chrome.tabs.query({});
        tabs.forEach(tab => updateTabTimestamp(tab.id));
        console.log('Initial tab timestamps updated.');
    } catch (error) {
        console.error("Error during onInstalled setup:", error);
        if (chrome.runtime.lastError) {
            console.error("chrome.runtime.lastError:", chrome.runtime.lastError.message);
        }
    }
});

// onAlarm: Fired when an alarm is triggered.
chrome.alarms.onAlarm.addListener((alarm) => {
    // If the triggered alarm is 'checkTabsAlarm', execute the core logic.
    if (alarm.name === 'checkTabsAlarm') {
        checkAndCloseTabs();
    }
});

// onActivated: Fired when the active tab in a window changes.
chrome.tabs.onActivated.addListener(activeInfo => {
    // Update the timestamp for the newly activated tab.
    updateTabTimestamp(activeInfo.tabId);
});

// onUpdated: Fired when a tab is updated.
// IMPORTANT IMPROVEMENT: This listener is now more efficient.
// It fires for many types of updates (e.g., status, URL, title, favicon).
// To prevent excessive storage writes, we only update the timestamp if:
// 1. The tab's URL has changed (indicating navigation to a new page).
// 2. The tab's loading status becomes 'complete' (indicating the page has finished loading).
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
        updateTabTimestamp(tabId);
    }
});

// onCreated: Fired when a new tab is created.
chrome.tabs.onCreated.addListener(tab => {
    // Update the timestamp for the newly created tab.
    updateTabTimestamp(tab.id);
});

// onRemoved: Fired when a tab is closed.
chrome.tabs.onRemoved.addListener(tabId => {
    // Remove the tab's timestamp data from storage.
    removeTabData(tabId);
});
//312 to 328