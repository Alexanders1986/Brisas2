CREATE TYPE "public"."pet_sex" AS ENUM('male', 'female');--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "sex" "pet_sex";--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "color" varchar(30);--> statement-breakpoint
ALTER TABLE "pets" ADD COLUMN "vaccines_up_to_date" boolean DEFAULT false NOT NULL;