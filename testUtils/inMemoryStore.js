function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class InMemoryStore {
  constructor(options = {}) {
    this.gachaState = clone(options.gachaState || {});
    this.users = new Map();
    for (const [userId, user] of Object.entries(options.users || {})) {
      this.users.set(String(userId), clone(user));
    }

    this.initCalls = 0;
    this.saveGachaStateCalls = 0;
    this.saveUserCalls = 0;
  }

  async init() {
    this.initCalls += 1;
  }

  async getGachaState() {
    return clone(this.gachaState);
  }

  async saveGachaState(state) {
    this.gachaState = clone(state || {});
    this.saveGachaStateCalls += 1;
  }

  async getUser(userId) {
    const user = this.users.get(String(userId));
    return user ? clone(user) : null;
  }

  async saveUser(userId, user) {
    this.users.set(String(userId), clone(user));
    this.saveUserCalls += 1;
  }

  async getAllUsers() {
    const users = [];
    for (const [userId, user] of this.users.entries()) {
      users.push({
        userId: String(userId),
        user: clone(user),
      });
    }
    return users;
  }
}

module.exports = {
  InMemoryStore,
};
