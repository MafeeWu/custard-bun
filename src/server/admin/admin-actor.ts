import "server-only";

export interface AdminActor {
  userId: string;
  label: string;
  operationId: string;
}

export interface AdminSession {
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
    role?: string | null;
    banned?: boolean | null;
  };
}

export function toAdminActor(
  session: AdminSession,
  operationId: string,
): AdminActor {
  if (session.user.role !== "admin" || session.user.banned === true) {
    throw new Error("Administrator access required");
  }

  return {
    userId: session.user.id,
    label: session.user.email ?? session.user.name ?? session.user.id,
    operationId,
  };
}
