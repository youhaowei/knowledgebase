export class NotSupportedError extends Error {
  constructor(method: string) {
    super(`${method} is not supported in LadybugDB mode`);
    this.name = "NotSupportedError";
  }
}
