import { AppCenteredMessage } from "~/components/app-centered-message";

export function NoPlexServers() {
  return (
    <AppCenteredMessage
      title="Welcome to Multiplex"
      description="No Plex servers found. Please configure your Plex account."
    />
  );
}
