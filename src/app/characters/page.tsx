import { CharacterCard } from "@/components/characters/character-card";
import { listPublicCharacters } from "@/server/characters/character-queries";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";

export default async function CharactersCatalogPage() {
  const database = await getDatabase();
  const characters = await listPublicCharacters(database);

  return (
    <main className="page-shell">
      <section className="page-stack">
        <header className="page-stack">
          <p className="character-eyebrow">Official catalog</p>
          <h1>Browse characters</h1>
          <p>
            Meet the official companions available for new conversations across
            this app.
          </p>
        </header>

        {characters.length === 0 ? (
          <p>No official characters are available right now.</p>
        ) : (
          <ul className="character-grid" aria-label="Official characters">
            {characters.map((character) => (
              <li key={character.id}>
                <CharacterCard character={character} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
