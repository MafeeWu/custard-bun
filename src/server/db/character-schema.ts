import type { CharacterContent } from "@/server/characters/character-content";
import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const characterLifecycleEnum = pgEnum("character_lifecycle", [
  "active",
  "archived",
]);

export type CharacterLifecycle =
  (typeof characterLifecycleEnum.enumValues)[number];

function characterContentColumns() {
  return {
    displayName: text("display_name").notNull(),
    avatarPath: text("avatar_path").notNull(),
    shortDescription: text("short_description").notNull(),
    longDescription: text("long_description").notNull(),
    personalityPrinciples:
      jsonb("personality_principles").$type<
        CharacterContent["personalityPrinciples"]
      >().notNull(),
    speakingStyle: text("speaking_style").notNull(),
    responseRhythm: text("response_rhythm").notNull(),
    relationshipBoundaries:
      jsonb("relationship_boundaries").$type<
        CharacterContent["relationshipBoundaries"]
      >().notNull(),
    openingMessage: text("opening_message").notNull(),
    exampleConversations:
      jsonb("example_conversations").$type<
        CharacterContent["exampleConversations"]
      >().notNull(),
    generationParameters:
      jsonb("generation_parameters").$type<
        CharacterContent["generationParameters"]
      >().notNull(),
    safetyAdditions: jsonb("safety_additions").$type<
      CharacterContent["safetyAdditions"]
    >().notNull(),
  };
}

export const character = pgTable("characters", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  lifecycle: characterLifecycleEnum("lifecycle").notNull().default("active"),
  defaultVersionId: text("default_version_id").references(
    (): AnyPgColumn => characterVersion.id,
    {
      onDelete: "restrict",
    },
  ),
  createdBy: text("created_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: text("archived_by").references(() => user.id, {
    onDelete: "set null",
  }),
});

export const characterDraft = pgTable("character_drafts", {
  characterId: text("character_id")
    .primaryKey()
    .references(() => character.id, {
      onDelete: "restrict",
    }),
  revision: integer("revision").notNull().default(1),
  baseVersionId: text("base_version_id").references(
    (): AnyPgColumn => characterVersion.id,
    {
      onDelete: "restrict",
    },
  ),
  ...characterContentColumns(),
  updatedBy: text("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const characterVersion = pgTable(
  "character_versions",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, {
        onDelete: "restrict",
      }),
    versionNumber: integer("version_number").notNull(),
    ...characterContentColumns(),
    contentDigest: varchar("content_digest", { length: 64 }).notNull(),
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("character_versions_character_id_version_number_unique").on(
      table.characterId,
      table.versionNumber,
    ),
    unique("character_versions_character_id_id_unique").on(
      table.characterId,
      table.id,
    ),
  ],
);
