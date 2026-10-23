CREATE TABLE "demo_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"tenant_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "demo_user_tenant_name_idx" ON "demo_user" USING btree ("tenant_id","name","id");--> statement-breakpoint
CREATE INDEX "demo_user_name_idx" ON "demo_user" USING btree ("name","id");