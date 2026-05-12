CREATE TABLE `multiplex_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `multiplex_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `multiplex_post` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text(256),
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE INDEX `name_idx` ON `multiplex_post` (`name`);--> statement-breakpoint
CREATE TABLE `multiplex_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `multiplex_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `multiplex_session_token_unique` ON `multiplex_session` (`token`);--> statement-breakpoint
CREATE TABLE `multiplex_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`plex_id` integer,
	`plex_uuid` text,
	`plex_username` text,
	`plex_auth_token` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `multiplex_user_email_unique` ON `multiplex_user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `multiplex_user_plex_id_unique` ON `multiplex_user` (`plex_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `multiplex_user_plex_uuid_unique` ON `multiplex_user` (`plex_uuid`);--> statement-breakpoint
CREATE TABLE `multiplex_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
