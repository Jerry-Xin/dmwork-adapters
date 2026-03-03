# DMWork Plugin Fix for OpenClaw 3.1 Compatibility

## Problem
`TypeError: undefined is not a function` when SDK function `buildPendingHistoryContextFromMap` processes history entries.

Stack trace:
```
buildPendingHistoryContextFromMap → buildHistoryContextFromEntries → Array.map
TypeError: undefined is not a function
```

## Solution
1. Bypass the SDK's `buildPendingHistoryContextFromMap` function (compatibility issue)
2. Use manual approach to build history context (JSON format)
3. Add `getChannelMessages()` API function for fetching history from API when memory cache is empty

## Files to Modify

### 1. src/inbound.ts

Find the section that handles bot mentions and replace the SDK function usage with manual approach:

```typescript
// Import the new function
import { sendMessage, sendReadReceipt, sendTyping, getChannelMessages } from "./api-fetch.js";

// In the mention handling section, replace:
// if (typeof buildPendingHistoryContextFromMap === "function") { ... }

// With this manual approach:
let entries = groupHistories.get(sessionId) ?? [];
const historyCountBefore = entries.length;
log?.info?.(`dmwork: [MENTION] 收到@消息 | from=${message.from_uid} | 内存缓存=${historyCountBefore}条 | session=${sessionId}`);

// If memory cache is empty, try fetching from API
if (entries.length === 0 && account.config.botToken) {
  log?.info?.(`dmwork: [MENTION] 内存缓存为空，尝试从API获取历史...`);
  try {
    const apiMessages = await getChannelMessages({
      apiUrl: account.config.apiUrl,
      botToken: account.config.botToken,
      channelId: message.channel_id!,
      channelType: ChannelType.Group,
      limit: 10,
    });
    entries = apiMessages
      .filter((m: any) => m.from_uid !== botUid && m.content && !m.content.includes(`@${botUid}`))
      .slice(-10)
      .map((m: any) => ({
        sender: m.from_uid,
        body: m.content,
        timestamp: m.timestamp * 1000,
      }));
    log?.info?.(`dmwork: [MENTION] 从API获取到 ${entries.length} 条历史消息`);
  } catch (err) {
    log?.error?.(`dmwork: [MENTION] 从API获取历史失败: ${err}`);
  }
}

// Build history context manually
if (entries.length > 0) {
  historyPrefix = "Chat history since last reply (untrusted, for context):\n```json\n" +
    JSON.stringify(entries.map((e: any) => ({
      sender: e.sender,
      timestamp_ms: e.timestamp,
      body: e.body,
    })), null, 2) +
    "\n```\n\n";
  log?.info?.(`dmwork: [MENTION] 已注入历史上下文 | ${historyPrefix.length} chars | ${entries.length}条消息`);
} else {
  log?.info?.(`dmwork: [MENTION] 无历史上下文可注入`);
}

// Clear history after consuming (manual approach)
groupHistories.delete(sessionId);
log?.info?.(`dmwork: [MENTION] 历史队列已清空 | session=${sessionId}`);
```

### 2. src/api-fetch.ts

Add this new function at the end of the file:

```typescript
/**
 * 获取频道历史消息（用于注入上下文）
 */
export async function getChannelMessages(params: {
  apiUrl: string;
  botToken: string;
  channelId: string;
  channelType: ChannelType;
  limit?: number;
  signal?: AbortSignal;
}): Promise<Array<{ from_uid: string; content: string; timestamp: number }>> {
  try {
    const url = `${params.apiUrl.replace(/\/+$/, "")}/v1/bot/channel/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.botToken}`,
      },
      body: JSON.stringify({
        channel_id: params.channelId,
        channel_type: params.channelType,
        limit: params.limit ?? 20,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      console.log(`[dmwork] getChannelMessages failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.messages ?? data ?? []).map((m: any) => ({
      from_uid: m.from_uid ?? m.sender_id ?? "unknown",
      content: m.payload?.content ?? m.content ?? "",
      timestamp: m.timestamp ?? Date.now(),
    }));
  } catch (err) {
    console.log(`[dmwork] getChannelMessages error: ${err}`);
    return [];
  }
}
```

## Why This Fix?
- The SDK's `buildPendingHistoryContextFromMap` function expects history entries in a specific format that doesn't match what dmwork plugin stores
- Manual approach is more robust and doesn't depend on SDK internals
- Added API fallback so history context works even after gateway restart (when memory cache is empty)
