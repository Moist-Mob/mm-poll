export class UserVisibleError extends Error {
  constructor(message: string) {
    super(message);

    Object.setPrototypeOf(this, UserVisibleError.prototype);
  }
}
