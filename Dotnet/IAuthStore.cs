namespace VRCX
{
    /// <summary>
    /// Minimal auth-store abstraction for primary cookie persistence.
    ///
    /// Each database backend (SQLite / MySQL / PostgreSQL) implements this
    /// interface so <see cref="WebApi"/> talks to whichever engine is
    /// currently active — there is no cross-engine "init another backend"
    /// dualism. The cookies table is created and queried with engine-native
    /// DDL / SQL / parameter style inside each implementation, hiding the
    /// driver differences (named vs positional parameters, INSERT OR REPLACE
    /// vs ON DUPLICATE KEY vs ON CONFLICT, TEXT vs VARCHAR/LONGTEXT, etc.).
    ///
    /// Only the primary account cookie (key = "default") is persisted by
    /// this contract. Secondary account cookies live in-memory in WebApi's
    /// <c>_secondaryClients</c> map and are not covered here.
    /// </summary>
    internal interface IAuthStore
    {
        /// <summary>
        /// Idempotently create the primary cookies table using the engine's
        /// native DDL. Called by WebApi before the first read/write so the
        /// table always exists on the active backend regardless of which
        /// engine was configured.
        /// </summary>
        void EnsureCookiesTable();

        /// <summary>
        /// Load a cookie value by key, or <c>null</c> when the row is absent.
        /// </summary>
        string? LoadCookie(string key);

        /// <summary>
        /// Upsert a cookie value by key (idempotent insert-or-replace).
        /// </summary>
        void SaveCookie(string key, string value);
    }
}