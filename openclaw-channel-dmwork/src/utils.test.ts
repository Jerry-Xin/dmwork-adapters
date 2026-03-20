import { describe, it, expect } from "vitest";
import { stripSpacePrefix } from "./utils.js";

describe("stripSpacePrefix", () => {
  it("strips Space prefix from prefixed ID", () => {
    expect(stripSpacePrefix("sd7d36a_jeff_bot")).toBe("jeff_bot");
  });

  it("strips short Space prefix", () => {
    expect(stripSpacePrefix("s1_uid")).toBe("uid");
  });

  it("returns unchanged ID when no prefix", () => {
    expect(stripSpacePrefix("jeff_bot")).toBe("jeff_bot");
  });

  it("returns unchanged ID for plain string without underscore", () => {
    expect(stripSpacePrefix("alice")).toBe("alice");
  });

  it("returns unchanged for string starting with s but no underscore", () => {
    expect(stripSpacePrefix("steve")).toBe("steve");
  });

  it("handles empty string", () => {
    expect(stripSpacePrefix("")).toBe("");
  });
});

describe("DM filter with stripSpacePrefix", () => {
  const botId = "jeff_bot";

  function dmFilterIncludes(channelId: string, robotId: string): boolean {
    const parts = channelId.split("@").map(stripSpacePrefix);
    return parts.includes(robotId);
  }

  it("matches bot in old format channel_id", () => {
    expect(dmFilterIncludes("alice@jeff_bot", botId)).toBe(true);
  });

  it("matches bot in new Space-prefixed format", () => {
    expect(dmFilterIncludes("sd7d36a_alice@sd7d36a_jeff_bot", botId)).toBe(true);
  });

  it("matches bot when bot is first part", () => {
    expect(dmFilterIncludes("sd7d36a_jeff_bot@sd7d36a_alice", botId)).toBe(true);
  });

  it("excludes unrelated channel", () => {
    expect(dmFilterIncludes("sd7d36a_alice@sd7d36a_bob", botId)).toBe(false);
  });

  it("excludes unrelated old format channel", () => {
    expect(dmFilterIncludes("alice@bob", botId)).toBe(false);
  });
});
