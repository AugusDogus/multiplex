interface AppCenteredMessageProps {
  title: string;
  description: string;
}

export function AppCenteredMessage({
  title,
  description,
}: AppCenteredMessageProps) {
  return (
    <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground mt-2">{description}</p>
      </div>
    </div>
  );
}
