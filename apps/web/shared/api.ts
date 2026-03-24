import { ApiClient } from "@multica/sdk";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export const api = new ApiClient(API_BASE_URL);

// Initialize token from localStorage on load
if (typeof window !== "undefined") {
  const token = localStorage.getItem("multica_token");
  if (token) {
    api.setToken(token);
  }
  const wsId = localStorage.getItem("multica_workspace_id");
  if (wsId) {
    api.setWorkspaceId(wsId);
  }
}
