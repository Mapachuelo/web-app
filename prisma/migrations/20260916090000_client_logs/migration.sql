-- CreateTable
CREATE TABLE "client_logs" (
    "id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "app_version" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "entries_count" INTEGER NOT NULL,
    "received_at" BIGINT NOT NULL,

    CONSTRAINT "client_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_logs_device_id_idx" ON "client_logs"("device_id");

-- CreateIndex
CREATE INDEX "client_logs_received_at_idx" ON "client_logs"("received_at");
