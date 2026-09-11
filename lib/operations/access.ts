import {
  requireApiUser,
  isSameOrigin,
  isAdmin,
  type DashboardUser,
} from "../auth/access";
import { HttpError } from "../http";
export const manager = (u: DashboardUser) =>
  isAdmin(u) || u.role === "support_manager";
export async function access(
  request?: Request,
  area: "inventory" | "support" = "inventory",
) {
  const a = await requireApiUser();
  if (a.response) throw new HttpError(401, "Please sign in to continue");
  if (request && request.method !== "GET" && !isSameOrigin(request))
    throw new HttpError(403, "Invalid request origin");
  if (area === "support" && !manager(a.user) && a.user.role !== "support_agent")
    throw new HttpError(
      403,
      "A support role is required. Ask an administrator to assign one in Manage users.",
    );
  if (
    area === "inventory" &&
    request &&
    request.method !== "GET" &&
    !isAdmin(a.user) &&
    !["operations", "warehouse"].includes(a.user.role)
  )
    throw new HttpError(403, "Inventory editing permission is required");
  return a.user;
}
