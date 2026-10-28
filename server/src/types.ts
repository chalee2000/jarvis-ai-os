export interface AuthContext {
  userId: string;
  username: string;
  csrfToken: string;
  sessionIdHash: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
