export interface SecretProvider {
  getSecret(name: string): Promise<SecretLookup>;
}

export type SecretLookup =
  | { status: "found"; name: string; value: string }
  | { status: "not_found"; name: string; reason_code: "secret_not_found" };

class InMemorySecretProvider implements SecretProvider {
  private readonly values: Map<string, string>;

  constructor(values: Record<string, string> | Map<string, string> = {}) {
    this.values = values instanceof Map ? new Map(values) : new Map(Object.entries(values));
  }

  async getSecret(name: string): Promise<SecretLookup> {
    const value = this.values.get(name);
    if (value === undefined) {
      return { status: "not_found", name, reason_code: "secret_not_found" };
    }
    return { status: "found", name, value };
  }

  setSecret(name: string, value: string): void {
    this.values.set(name, value);
  }

  deleteSecret(name: string): boolean {
    return this.values.delete(name);
  }
}

module.exports = {
  InMemorySecretProvider,
};
