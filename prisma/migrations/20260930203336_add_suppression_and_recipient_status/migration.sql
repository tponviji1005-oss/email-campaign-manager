-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'HARD_BOUNCE', 'SPAM', 'BLOCKED', 'INVALID');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'SOFT_BOUNCED', 'BOUNCED', 'BLOCKED', 'SPAM', 'INVALID', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT false,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "suppressReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignHistory" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "totalRecipients" INTEGER NOT NULL,
    "validRecipients" INTEGER NOT NULL,
    "invalidRecipients" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Campaign_userId_idx" ON "Campaign"("userId");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Recipient_email_idx" ON "Recipient"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_campaignId_email_key" ON "Recipient"("campaignId", "email");

-- CreateIndex
CREATE INDEX "Attachment_campaignId_idx" ON "Attachment"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignHistory_campaignId_idx" ON "CampaignHistory"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignHistory_sentAt_idx" ON "CampaignHistory"("sentAt");

-- CreateIndex
CREATE INDEX "Suppression_userId_idx" ON "Suppression"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_userId_email_key" ON "Suppression"("userId", "email");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignHistory" ADD CONSTRAINT "CampaignHistory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
