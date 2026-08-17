import "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    email: string;
    name?: string;
    workspaceId?: string;
  }

  interface Session {
    user: User;
  }
}
