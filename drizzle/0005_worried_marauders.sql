CREATE TABLE `product_gen_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`phase` varchar(1) NOT NULL,
	`kind` enum('lifestyle_regular','lifestyle_pro','mockup_base','mockup_recolor') NOT NULL,
	`frameColor` varchar(32),
	`prompt` text NOT NULL,
	`referenceImageB64` longtext NOT NULL,
	`referenceMimeType` varchar(64) NOT NULL,
	`aspectRatio` varchar(8) NOT NULL,
	`status` enum('pending','submitted','succeeded','failed') NOT NULL DEFAULT 'pending',
	`batchName` varchar(128),
	`batchRequestKey` varchar(64),
	`resultB64` longtext,
	`resultMimeType` varchar(64),
	`attempts` int NOT NULL DEFAULT 0,
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_gen_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `genPhase` varchar(8);--> statement-breakpoint
ALTER TABLE `products` ADD `genParams` json;