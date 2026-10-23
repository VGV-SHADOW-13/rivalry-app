/**
 * One-time migration: old shared data -> a private rivalry between two accounts.
 *
 *   old:  rivalry/shared          (player1 / player2 scores, tasks, names)
 *         rivalry-chat/*          (chat messages)
 *   new:  rivalries/{id}          (members = both users' uids)
 *         rivalries/{id}/messages/*
 *         invites/{id}            (closed)
 *
 * Both people must have SIGNED UP in the app first (so their accounts exist).
 *
 * Setup (once):
 *   npm i -D firebase-admin
 *   Firebase Console -> Project settings -> Service accounts -> Generate new private key
 *   Save it as ./serviceAccount.json   (NEVER commit it; it's in .gitignore below)
 *
 * Usage:
 *   node scripts/migrate-old-data.mjs --player1=a@x.com --player2=b@y.com --dry-run
 *   node scripts/migrate-old-data.mjs --player1=a@x.com --player2=b@y.com
 *
 * Options:
 *   --name="Our Rivalry"   name of the new rivalry (default "Our Rivalry")
 *   --key=path/to/key.json service account file (default ./serviceAccount.json)
 *   --force                run even if a migrated rivalry already exists
 *   --dry-run              read + back up + print what would happen; write nothing
 *
 * A JSON backup of the old data is always written to ./backup-<timestamp>.json first.
 * The old documents are never modified or deleted.
 */
import { readFileSync, writeFileSync } from "node:fs";
import admin from "firebase-admin";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  })
);

const p1Email = args.player1;
const p2Email = args.player2;
const name = args.name && args.name !== true ? args.name : "Our Rivalry";
const keyPath = args.key && args.key !== true ? args.key : "./serviceAccount.json";
const dryRun = !!args["dry-run"];

if (!p1Email || !p2Email || p1Email === true || p2Email === true) {
  console.error('Usage: node scripts/migrate-old-data.mjs --player1=a@x.com --player2=b@y.com [--dry-run]');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf8"))) });
const db = admin.firestore();
const auth = admin.auth();

async function getUser(email) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    console.error(`No account found for ${email}. Have they signed up in the app yet?`);
    process.exit(1);
  }
}

const [u1, u2] = await Promise.all([getUser(p1Email), getUser(p2Email)]);
if (u1.uid === u2.uid) { console.error("player1 and player2 are the same account."); process.exit(1); }

// ---- read old data ----
const sharedSnap = await db.doc("rivalry/shared").get();
const chatSnap = await db.collection("rivalry-chat").orderBy("timestamp", "asc").get();

if (!sharedSnap.exists) {
  console.error("Old document rivalry/shared doesn't exist — nothing to migrate (data may have been reset).");
  process.exit(1);
}
const old = sharedSnap.data();
const oldChat = chatSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

// ---- always back up first ----
const backupFile = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(backupFile, JSON.stringify({ shared: old, chat: oldChat }, null, 2));
console.log(`Backup written: ${backupFile}`);

const p1Pts = old.player1?.totalPoints ?? 0;
const p2Pts = old.player2?.totalPoints ?? 0;
console.log(`Old data: ${old.tasks?.length ?? 0} tasks, ${oldChat.length} messages`);
console.log(`  player1 "${old.names?.player1}" -> ${p1Email}: ${p1Pts} pts`);
console.log(`  player2 "${old.names?.player2}" -> ${p2Email}: ${p2Pts} pts`);
if (p1Pts === 0 && p2Pts === 0 && oldChat.length === 0) {
  console.warn("WARNING: the old data looks like stock defaults (0 points, no chat). It may already have been reset.");
}

// ---- guard against double migration ----
if (!args.force) {
  const existing = await db.collection("rivalries").where("migratedFrom", "==", "rivalry/shared").limit(1).get();
  if (!existing.empty) {
    console.error(`Already migrated (rivalries/${existing.docs[0].id}). Use --force to migrate again.`);
    process.exit(1);
  }
}

if (dryRun) { console.log("Dry run — nothing written."); process.exit(0); }

// ---- write new data ----
const rivalryRef = db.collection("rivalries").doc();
const uidFor = { player1: u1.uid, player2: u2.uid };

await rivalryRef.set({
  name,
  ownerUid: u1.uid,
  members: [u1.uid, u2.uid],
  memberNames: {
    [u1.uid]: old.names?.player1 || u1.displayName || "Player 1",
    [u2.uid]: old.names?.player2 || u2.displayName || "Player 2",
  },
  tasks: old.tasks || [],
  players: {
    [u1.uid]: { totalPoints: p1Pts, daily: old.player1?.daily || {} },
    [u2.uid]: { totalPoints: p2Pts, daily: old.player2?.daily || {} },
  },
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  migratedFrom: "rivalry/shared",
});

await db.doc(`invites/${rivalryRef.id}`).set({
  name, ownerUid: u1.uid, ownerName: old.names?.player1 || "Player 1", open: false,
});

// messages in batches of 400
for (let i = 0; i < oldChat.length; i += 400) {
  const batch = db.batch();
  for (const m of oldChat.slice(i, i + 400)) {
    batch.set(rivalryRef.collection("messages").doc(), {
      text: m.text || "",
      sender: uidFor[m.sender] || u1.uid,
      senderName: m.senderName || "Player",
      timestamp: m.timestamp || admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

console.log(`Done. New rivalry: rivalries/${rivalryRef.id}`);
console.log("Both users will see it on their home screen after logging in.");
