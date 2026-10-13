CREATE TYPE "public"."gender" AS ENUM('female', 'male', 'other', 'undisclosed');--> statement-breakpoint
CREATE TYPE "public"."kinship" AS ENUM('spouse', 'partner', 'child', 'father', 'mother', 'sibling', 'grandparent', 'grandchild', 'other_relative', 'roommate', 'employee', 'other');--> statement-breakpoint
CREATE TYPE "public"."powertrain" AS ENUM('combustion', 'electric', 'hybrid', 'human');--> statement-breakpoint
CREATE TYPE "public"."vehicle_kind" AS ENUM('car', 'motorcycle', 'bicycle', 'scooter', 'other');--> statement-breakpoint
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"first_name" varchar(80) NOT NULL,
	"last_name" varchar(80) NOT NULL,
	"kinship" "kinship" NOT NULL,
	"gender" "gender" NOT NULL,
	"birth_date" date NOT NULL,
	"phone" varchar(20),
	"email" varchar(254),
	"receives_notifications" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_notification_contact" CHECK (NOT "household_members"."receives_notifications" OR "household_members"."phone" IS NOT NULL OR "household_members"."email" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" "vehicle_kind" NOT NULL,
	"powertrain" "powertrain" NOT NULL,
	"plate" varchar(10),
	"brand" varchar(40),
	"model" varchar(40),
	"model_year" integer,
	"color" varchar(30) NOT NULL,
	"notes" varchar(200),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_required" CHECK ("vehicles"."kind" NOT IN ('car', 'motorcycle') OR "vehicles"."plate" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "gender" "gender";--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_property_fk" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_property_fk" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_members_tenant_property_idx" ON "household_members" USING btree ("tenant_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_tenant_plate_key" ON "vehicles" USING btree ("tenant_id","plate") WHERE "vehicles"."plate" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "vehicles_tenant_property_idx" ON "vehicles" USING btree ("tenant_id","property_id");