import 'express-session';

export type Role = 'superadmin' | 'admin_ipad' | 'admin_dept';
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  must_change_pw: boolean;
  phone: string | null;
  dept_ids: number[];
}

declare module 'express-session' {
  interface SessionData {
    userId: string;
    loginAt: number;
    csrf: string;
    stepUpUntil: number;
  }
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
