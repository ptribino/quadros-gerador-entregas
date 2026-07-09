ALTER TABLE `products` ADD `mockupUrlLightWood` text;--> statement-breakpoint
ALTER TABLE `products` ADD `mockupUrlDarkWood` text;--> statement-breakpoint
ALTER TABLE `products` ADD `mockupUrlWhite` text;--> statement-breakpoint
ALTER TABLE `products` ADD `mockupUrlBlack` text;--> statement-breakpoint
ALTER TABLE `products` ADD `genQueuedAt` timestamp;--> statement-breakpoint
ALTER TABLE `products` ADD `genStartedAt` timestamp;--> statement-breakpoint
ALTER TABLE `products` ADD `genCompletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `products` ADD `genStep` int;--> statement-breakpoint
ALTER TABLE `products` ADD `genAttempts` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `genError` text;--> statement-breakpoint
ALTER TABLE `products` ADD `genStyleOverride` varchar(32);