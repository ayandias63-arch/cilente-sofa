const { BufferJSON } = require("@whiskeysockets/baileys");
const { proto } = require("@whiskeysockets/baileys");
const { initAuthCreds } = require("@whiskeysockets/baileys");
const { Mutex } = require("async-mutex");

function serialize(data) {
  return JSON.stringify(data, BufferJSON.replacer);
}

function deserialize(text) {
  return JSON.parse(text, BufferJSON.reviver);
}

async function readData(collection, key) {
  const doc = await collection.findOne({ _id: key });
  if (!doc || typeof doc.data !== "string") return null;
  return deserialize(doc.data);
}

async function writeData(collection, key, data, locks) {
  if (!locks.has(key)) locks.set(key, new Mutex());
  const mutex = locks.get(key);

  await mutex.runExclusive(async () => {
    const serialized = serialize(data);
    await collection.updateOne(
      { _id: key },
      { $set: { data: serialized } },
      { upsert: true }
    );
  });
}

async function removeData(collection, key, locks) {
  if (!locks.has(key)) locks.set(key, new Mutex());
  const mutex = locks.get(key);

  await mutex.runExclusive(async () => {
    await collection.deleteOne({ _id: key });
  });
}

async function useMongoAuthState(collection) {
  if (!collection) {
    throw new Error("A MongoDB collection is required for auth state");
  }

  const locks = new Map();
  const creds = (await readData(collection, "creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              const value = await readData(collection, `${type}-${id}`);
              data[id] =
                type === "app-state-sync-key" && value
                  ? proto.Message.AppStateSyncKeyData.fromObject(value)
                  : value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(
                value
                  ? writeData(collection, key, value, locks)
                  : removeData(collection, key, locks)
              );
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData(collection, "creds", creds, locks);
    },
  };
}

module.exports = {
  useMongoAuthState,
};