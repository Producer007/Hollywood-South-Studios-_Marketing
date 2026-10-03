const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Read side of the Hedera TESTNET record. Everything here uses the public mirror node and
// needs no credentials, so any third party can reproduce what these functions return.

const MIRROR = () => process.env.HEDERA_MIRROR_URL || "https://testnet.mirrornode.hedera.com";
// HEDERA_STATE_PATH lets tests (and a second collection) use a different file.
const STATE_PATH = process.env.HEDERA_STATE_PATH || path.join(__dirname, "..", "state.json");

// HCS splits messages over 1024 bytes into chunks. Waypoints are kept under that limit at
// write time, so a chunked message here was not written by this module and is skipped.
const HCS_MESSAGE_LIMIT = 1024;

async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mirror node ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function paged(firstPath, key) {
  const out = [];
  let url = `${MIRROR()}${firstPath}`;
  while (url) {
    const page = await getJson(url);
    if (!page) break;
    out.push(...(page[key] || []));
    url = page.links?.next ? `${MIRROR()}${page.links.next}` : null;
  }
  return out;
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// All messages on a topic, decoded, in consensus order.
async function topicMessages(topicId) {
  const raw = await paged(`/api/v1/topics/${topicId}/messages?limit=100&order=asc`, "messages");
  return raw
    .filter((m) => !m.chunk_info || m.chunk_info.total === 1)
    .map((m) => {
      const body = Buffer.from(m.message, "base64").toString("utf8");
      let msg = null;
      try {
        msg = JSON.parse(body);
      } catch {
        /* not ours */
      }
      return { seq: m.sequence_number, consensus: m.consensus_timestamp, body, msg };
    })
    .filter((m) => m.msg);
}

// The waypoints for one container, in consensus order. Consensus order, not the "at" field,
// is what defines the chain: it is assigned by the network, not by the writer.
async function waypointsFor(topicId, iso) {
  return (await topicMessages(topicId)).filter((m) => m.msg.t === "gcn_waypoint_v1" && m.msg.iso === iso);
}

// The last waypoint for a container as the network has it, which is what the next
// waypoint must chain to. Local state.json is only a cache of this.
async function lastWaypoint(topicId, iso) {
  const w = await waypointsFor(topicId, iso);
  if (!w.length) return null;
  const last = w[w.length - 1];
  const cumulativeMeters = w.reduce((s, m) => s + (m.msg.segmentMeters || 0), 0);
  return {
    at: last.msg.at, lat: last.msg.lat, lon: last.msg.lon,
    messageHash: sha256(last.body), seq: last.seq, waypoints: w.length, cumulativeMeters,
  };
}

// NFTs in the collection whose metadata begins with this ISO 6346 id ("ISO|hash16").
async function serialsFor(tokenId, iso) {
  const nfts = await paged(`/api/v1/tokens/${tokenId}/nfts?limit=100`, "nfts");
  return nfts
    .filter((n) => !n.deleted)
    .filter((n) => Buffer.from(n.metadata || "", "base64").toString("utf8").split("|")[0] === iso)
    .map((n) => n.serial_number);
}

const tokenInfo = (tokenId) => getJson(`${MIRROR()}/api/v1/tokens/${tokenId}`);
const topicInfo = (topicId) => getJson(`${MIRROR()}/api/v1/topics/${topicId}`);
const accountInfo = (id) => getJson(`${MIRROR()}/api/v1/accounts/${id}`);

function readState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}
function writeState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  MIRROR, HCS_MESSAGE_LIMIT, STATE_PATH, sha256, sleep,
  topicMessages, waypointsFor, lastWaypoint, serialsFor, tokenInfo, topicInfo, accountInfo,
  readState, writeState,
};
