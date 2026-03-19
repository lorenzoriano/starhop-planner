// StarHop Planner is a frontend-only application.
// No shared database schema is required for this project.

export interface User {
  id: string;
  username: string;
}

export interface InsertUser {
  username: string;
}
