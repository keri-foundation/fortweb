/**
 * Deterministic mock data for fixture routes.
 * Used by screenshot automation to reach every screen state
 * without a running wallet runtime.
 */

const FIXTURE_VAULT_ID = "fixture-vault-001";
const FIXTURE_AID = "EKYGGh-FtAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9OxmP";
const FIXTURE_REMOTE_AID = "EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao";

export const fixtureVault = {
    id: FIXTURE_VAULT_ID,
    alias: "Demo Vault",
    storageName: "IndexedDB",
    createdAt: "2026-04-01T12:00:00Z",
    otpConfigured: false,
    locked: false,
    identifierCount: 3,
    remoteCount: 5,
};

export const fixtureVaultLocked = {
    ...fixtureVault,
    locked: true,
};

export const fixtureVaults = [
    fixtureVault,
    {
        id: "fixture-vault-002",
        alias: "Work Vault",
        storageName: "IndexedDB",
        createdAt: "2026-03-15T09:30:00Z",
        otpConfigured: true,
        locked: true,
        identifierCount: 1,
        remoteCount: 2,
    },
];

export const fixtureIdentifiers = [
    {
        aid: FIXTURE_AID,
        alias: "primary-aid",
        prefix: FIXTURE_AID,
        sequenceNumber: 4,
        witnessSummary: "3/3 connected",
        lastEventDigest: "EMkPcg-L4G-fcKwAuUPxoh8RpjGrNfHmSLc3bMN0r5hO",
        status: "Established",
        statusTone: "success",
        kelEvents: 5,
        witnessCount: 3,
        oobi: "http://127.0.0.1:5642/oobi/EKYGGh-FtAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9OxmP/witness",
        witnesses: [
            { alias: "wan-witness-0", status: "connected", statusTone: "success" },
            { alias: "wan-witness-1", status: "connected", statusTone: "success" },
            { alias: "wan-witness-2", status: "connected", statusTone: "success" },
        ],
    },
    {
        aid: "EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao",
        alias: "backup-aid",
        prefix: "EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao",
        sequenceNumber: 1,
        witnessSummary: "3/3 connected",
        lastEventDigest: "EQNojhJ_jKKat-1dK-ld8J7YO5IUkz-yOV7h3BiflmNw",
        status: "Established",
        statusTone: "success",
        kelEvents: 2,
        witnessCount: 3,
        oobi: "http://127.0.0.1:5642/oobi/EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao/witness",
        witnesses: [
            { alias: "wan-witness-0", status: "connected", statusTone: "success" },
            { alias: "wan-witness-1", status: "connected", statusTone: "success" },
            { alias: "wan-witness-2", status: "pending", statusTone: "warning" },
        ],
    },
];

export const fixtureRemotes = [
    {
        aid: FIXTURE_REMOTE_AID,
        alias: "acme-corp",
        prefix: FIXTURE_REMOTE_AID,
        sequenceNumber: 2,
        transferable: true,
        transferability: "Transferable",
        rolesLabel: "witness, watcher",
        status: "Verified",
        statusTone: "success",
        org: "ACME Corporation",
        company: "ACME Corp",
        note: "Main trading partner",
        oobi: "http://127.0.0.1:5643/oobi/EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao",
        lastEventDigest: "EJkz-hGTAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9OxmP",
        keystateUpdatedAt: "2026-04-10T14:22:00Z",
        verificationCount: 3,
        kelEvents: 3,
        mailboxes: ["http://127.0.0.1:5644/mailbox"],
        roles: ["witness", "watcher"],
    },
    {
        aid: "EDWg3-FtAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9Ox00",
        alias: "partner-org",
        prefix: "EDWg3-FtAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9Ox00",
        sequenceNumber: null,
        transferable: false,
        transferability: "Non-transferable",
        rolesLabel: "witness",
        status: "Not resolved",
        statusTone: "warning",
        org: "",
        company: "",
        note: "",
        oobi: "",
        lastEventDigest: "",
        keystateUpdatedAt: null,
        verificationCount: 0,
        kelEvents: 0,
        mailboxes: [],
        roles: ["witness"],
    },
];

export const fixtureSettings = {
    tempDatastore: false,
    keyAlgorithm: "Ed25519",
    keyTier: "low",
    witnessProfile: "wan (3 witnesses, toad 2)",
    storageBackend: "IndexedDB",
    runtimeStatus: "Running",
};

export const fixtureBootstrapDisconnected = {
    bootUrl: "http://127.0.0.1:9723",
    connection: { ok: false, error: "Boot service unreachable at http://127.0.0.1:9723" },
    bootstrap: null,
    account: null,
};

export const fixtureBootstrapConnected = {
    bootUrl: "http://127.0.0.1:9723",
    connection: { ok: true, error: "" },
    bootstrap: {
        regionName: "US West",
        regionId: "us-west-1",
        watcherRequired: true,
        accountOptions: [
            { code: "wan", witnessCount: 3, toad: 2 },
            { code: "wil", witnessCount: 6, toad: 4 },
        ],
    },
    account: null,
};

export const fixtureBootstrapOnboarded = {
    bootUrl: "http://127.0.0.1:9723",
    connection: { ok: true, error: "" },
    bootstrap: {
        regionName: "US West",
        regionId: "us-west-1",
        watcherRequired: true,
        accountOptions: [
            { code: "wan", witnessCount: 3, toad: 2 },
        ],
    },
    account: {
        status: "onboarded",
        accountAlias: "kf-demo-account",
        accountAid: "EKeri-FtAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9OxmP",
        witnessProfileCode: "wan",
        regionName: "US West",
        regionId: "us-west-1",
        witnessCount: 3,
        toad: 2,
        bootUrl: "http://127.0.0.1:9723",
        bootServerAid: "EBoot-FtAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9OxmP",
        watcherRequired: true,
    },
};

export const fixtureWitnesses = [
    {
        eid: "EWit1-FtAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9OxmP",
        name: "KF Witness wan-0",
        regionName: "US West",
        regionId: "us-west-1",
        hostedStatus: "allocated",
        localStatus: "Connected",
        localStatusTone: "success",
        url: "http://witness0.keri.foundation:5632",
    },
    {
        eid: "EWit2-FtAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9OxmP",
        name: "KF Witness wan-1",
        regionName: "US West",
        regionId: "us-west-1",
        hostedStatus: "allocated",
        localStatus: "Connected",
        localStatusTone: "success",
        url: "http://witness1.keri.foundation:5633",
    },
    {
        eid: "EWit3-FtAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9OxmP",
        name: "KF Witness wan-2",
        regionName: "US West",
        regionId: "us-west-1",
        hostedStatus: "allocated",
        localStatus: "Pending local connect",
        localStatusTone: "warning",
        url: "http://witness2.keri.foundation:5634",
    },
];

export const fixtureWatchers = [
    {
        eid: "EWch1-FtAphGmSZbsuBs_t4qpsjYJ2ZqvMKluq9OxmP",
        name: "KF Watcher us-west-0",
        regionName: "US West",
        regionId: "us-west-1",
        hostedStatus: "created",
        localStatus: "Connected",
        localStatusTone: "success",
        url: "http://watcher0.keri.foundation:5640",
    },
];

export const FIXTURE_VAULT_ID_CONST = FIXTURE_VAULT_ID;
export const FIXTURE_AID_CONST = FIXTURE_AID;
export const FIXTURE_REMOTE_AID_CONST = FIXTURE_REMOTE_AID;
