require("dotenv").config();

const express = require("express");
const Console = require("./ConsoleUtils");
const CryptoUtils = require("./CryptoUtils");
const SharedUtils = require("./SharedUtils");

const {
    BackendUtils,
    UserModel,
    UserController,
    RoundController,
    BattlePassController,
    EconomyController,
    AnalyticsController,
    FriendsController,
    NewsController,
    MissionsController,
    TournamentXController,
    MatchmakingController,
    TournamentController,
    SocialController,
    EventsController,
    authenticate,
    errorControll,
    sendShared,
    OnlineCheck,
    VerifyPhoton
} = require("./BackendUtils");

const app = express();

const Title =
    "Stumble Dark Backend " +
    process.env.version;

const PORT =
    process.env.PORT || 8080;

app.use(express.json());

// ---------------------------------------------------------------------------
// Env helpers used by the MelonLoader client (IsUpdateRequired / MaintenanceSystem)
// ---------------------------------------------------------------------------

function isMaintenanceEnabled() {
    return (
        String(process.env.MAINTENANCE_MODE || "false")
            .toLowerCase()
            .trim() === "true"
    );
}

function getRequiredVersion() {
    return (
        String(process.env.REQUIRED_VERSION || "1.0.0")
            .trim()
            .replace(/^v/i, "")
    );
}

function getMaintenanceMessage() {
    return (
        process.env.MAINTENANCE_MESSAGE ||
        "Our servers are under maintenance and will be back online shortly!"
    );
}

function getUpdateMessage() {
    return (
        process.env.UPDATE_REQUIRED_MESSAGE ||
        "A new version of StumbleDark is required. Please update your game."
    );
}

function normalizeVersion(version) {
    if (!version) {
        return "";
    }

    return String(version)
        .trim()
        .replace(/^v/i, "");
}

// ---------------------------------------------------------------------------
// Public endpoints the MelonLoader mods hit (no auth)
// ---------------------------------------------------------------------------

// MaintenanceSystem.cs → GET /api/maintenance
app.get("/api/maintenance", (req, res) => {
    const maintenance =
        isMaintenanceEnabled();

    return res.status(200).json({
        maintenance,
        message: getMaintenanceMessage()
    });
});

// IsUpdateRequired.cs → GET /api/update-required?version=1.7.0
// ONLY the exact REQUIRED_VERSION is allowed. Older or newer → updateRequired=true
app.get("/api/update-required", (req, res) => {
    const clientVersion =
        normalizeVersion(req.query.version);

    const requiredVersion =
        getRequiredVersion();

    const message =
        getUpdateMessage();

    if (!clientVersion) {
        return res.status(400).json({
            updateRequired: true,
            error: "VERSION_MISSING",
            message:
                "Game version was not provided."
        });
    }

    // Exact match only — one allowed version
    const updateRequired =
        clientVersion !== requiredVersion;

    console.log(
        "[Update Check]",
        "Client:",
        clientVersion,
        "| Required:",
        requiredVersion,
        "| UpdateRequired:",
        updateRequired
    );

    return res.status(200).json({
        updateRequired,
        clientVersion,
        requiredVersion,
        message
    });
});

// BannedMessage.cs → GET /ban-status/:id
// Must stay public (no auth). Returns every key variant the C# client parses.
app.get("/ban-status/:id", async (req, res) => {
    try {
        const id =
            (req.params.id || "").trim();

        if (!id) {
            return res.status(200).json({
                isBanned: false,
                IsBanned: false,
                reason: "",
                banReason: "",
                BanReason: "",
                BannedReason: "",
                bannedReason: "",
                Reason: "",
                bannedAt: null,
                BannedAt: null
            });
        }

        let user =
            await UserModel.findByDeviceId(id);

        if (!user) {
            user =
                await UserModel.findByDeviceId(
                    id.toLowerCase()
                );
        }

        if (!user) {
            user =
                await UserModel.findByDeviceId(
                    id.toUpperCase()
                );
        }

        if (!user) {
            user =
                await UserModel.findByStumbleId(id);
        }

        if (!user) {
            user =
                await UserModel.findByStumbleId(
                    id.toUpperCase()
                );
        }

        if (!user) {
            return res.status(200).json({
                isBanned: false,
                IsBanned: false,
                reason: "",
                banReason: "",
                BanReason: "",
                BannedReason: "",
                bannedReason: "",
                Reason: "",
                bannedAt: null,
                BannedAt: null
            });
        }

        const banned =
            user.isBanned === true;

        const reason =
            user.banReason ||
            user.BannedReason ||
            "Banned";

        const bannedAt =
            user.bannedAt ||
            user.BannedAt ||
            null;

        return res.status(200).json({
            isBanned: banned,
            IsBanned: banned,
            reason: banned ? reason : "",
            banReason: banned ? reason : "",
            BanReason: banned ? reason : "",
            BannedReason: banned ? reason : "",
            bannedReason: banned ? reason : "",
            Reason: banned ? reason : "",
            bannedAt: banned ? bannedAt : null,
            BannedAt: banned ? bannedAt : null
        });
    } catch (err) {
        console.error(
            "Ban status error:",
            err
        );

        return res.status(500).json({
            isBanned: false,
            IsBanned: false,
            reason: "",
            banReason: "",
            BanReason: "",
            BannedReason: "",
            bannedReason: "",
            Reason: "",
            bannedAt: null,
            BannedAt: null
        });
    }
});

// ---------------------------------------------------------------------------
// Block most routes while maintenance is on (keep the 3 public checks open)
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
    const allowedDuringMaintenance = [
        "/api/maintenance",
        "/api/update-required",
        "/ban-status",
        "/api/v1/ping"
    ];

    const path =
        req.path || "";

    if (
        allowedDuringMaintenance.some(
            (p) =>
                path === p ||
                path.startsWith(p + "/")
        )
    ) {
        return next();
    }

    if (!isMaintenanceEnabled()) {
        return next();
    }

    return res.status(503).json({
        maintenance: true,
        error: "MAINTENANCE",
        message: getMaintenanceMessage()
    });
});

app.use(authenticate);

class CrownController {
    static async updateScore(req, res) {
        try {
            const {
                deviceid,
                username,
                country
            } = req.body;

            if (!deviceid || !username) {
                return res.status(400).json({
                    error: "Missing fields"
                });
            }

            let user =
                await UserModel.findByDeviceId(
                    deviceid
                );

            if (!user) {
                return res.status(404).json({
                    error: "User not found"
                });
            }

            const newCrowns =
                (user.crowns || 0) + 1;

            await UserModel.update(
                user.stumbleId,
                {
                    crowns: newCrowns
                }
            );

            res.json({
                success: true,
                crowns: newCrowns
            });
        } catch (err) {
            console.error(
                "Error updating crowns:",
                err
            );

            res.status(500).json({
                error:
                    "Internal server error"
            });
        }
    }

    static async list(req, res) {
        try {
            const {
                country,
                start,
                count
            } = req.query;

            const data =
                await UserModel.GetHighscore(
                    "crowns",
                    country || "",
                    start || 0,
                    count || 50
                );

            res.json(data);
        } catch (err) {
            console.error(
                "Error fetching crown highscores:",
                err
            );

            res.status(500).json({
                error:
                    "Internal server error"
            });
        }
    }
}

app.post(
    "/photon/auth",
    VerifyPhoton
);

app.get(
    "/onlinecheck",
    OnlineCheck
);

app.get(
    "/matchmaking/filter",
    MatchmakingController.getMatchmakingFilter
);

app.post(
    "/user/login",
    UserController.login
);

app.get(
    "/user/tournament-wins",
    UserController.getTournamentWins
);

app.get(
    "/user/config",
    sendShared
);

app.get(
    "/usersettings",
    UserController.getSettings
);

app.post(
    "/user/updateusername",
    UserController.updateUsername
);

app.get(
    "/user/deleteaccount",
    UserController.deleteAccount
);

app.post(
    "/user/linkplatform",
    UserController.linkPlatform
);

app.post(
    "/user/unlinkplatform",
    UserController.unlinkPlatform
);

app.get(
    "/shared/:version/:type",
    sendShared
);

app.post(
    "/user/profile",
    UserController.getProfile
);

app.post(
    "/user-equipped-cosmetics/update",
    UserController.updateCosmetics
);

app.post(
    "/user/cosmetics/addskin",
    UserController.addSkin
);

app.post(
    "/user/cosmetics/setequipped",
    UserController.setEquippedCosmetic
);

app.get(
    "/round/finish/:round",
    RoundController.finishRound
);

app.get(
    "/round/finishv2/:round",
    RoundController.finishRound
);

app.post(
    "/round/finish/v4/:round",
    RoundController.finishRoundV4
);

app.post(
    "/round/eventfinish/v4/:round",
    RoundController.finishRoundV4
);

app.get(
    "/battlepass",
    BattlePassController.getBattlePass
);

app.post(
    "/battlepass/claimv3",
    BattlePassController.claimReward
);

app.post(
    "/battlepass/purchase",
    BattlePassController.purchaseBattlePass
);

app.post(
    "/battlepass/complete",
    BattlePassController.completeBattlePass
);

app.get(
    "/economy/purchase/:item",
    EconomyController.purchase
);

app.get(
    "/economy/purchasegasha/:itemId/:count",
    EconomyController.purchaseGasha
);

app.post(
    "/economy/:currencyType/give/:amount",
    EconomyController.giveCurrency
);

app.get(
    "/economy/purchaseluckyspin",
    EconomyController.purchaseLuckySpin
);

app.get(
    "/economy/purchasedrop/:itemId/:count",
    EconomyController.purchaseLuckySpin
);

app.get(
    "/missions",
    MissionsController.getMissions
);

app.post(
    "/missions/:missionId/rewards/claim/v2",
    MissionsController.claimMissionReward
);

app.post(
    "/missions/objective/:objectiveId/:milestoneId/rewards/claim/v2",
    MissionsController.claimMilestoneReward
);

app.post(
    "/friends/request/accept",
    FriendsController.add
);

app.delete(
    "/friends/:UserId",
    FriendsController.remove
);

app.get(
    "/friends",
    FriendsController.list
);

app.post(
    "/friends/search",
    FriendsController.search
);

app.post(
    "/friends/request",
    FriendsController.request
);

app.post(
    "/friends/accept",
    FriendsController.accept
);

app.post(
    "/friends/request/decline",
    FriendsController.reject
);

app.post(
    "/friends/cancel",
    FriendsController.cancel
);

app.get(
    "/friends/request",
    FriendsController.pending
);

app.get(
    "/game-events/me",
    EventsController.getActive
);

app.get(
    "/news/getall",
    NewsController.GetNews
);

app.post(
    "/analytics",
    AnalyticsController.analytic
);

app.post(
    "/update-crown-score",
    CrownController.updateScore
);

app.get(
    "/highscore/crowns/list",
    CrownController.list
);

app.get(
    "/highscore/:type/list/",
    async (req, res, next) => {
        try {
            const {
                type
            } = req.params;

            const {
                start = 0,
                count = 100,
                country = "global"
            } = req.query;

            const startNum =
                parseInt(
                    start,
                    10
                );

            const countNum =
                parseInt(
                    count,
                    10
                );

            if (!type) {
                return res.status(400).json({
                    error:
                        "O tipo é necessário"
                });
            }

            if (
                isNaN(startNum) ||
                isNaN(countNum)
            ) {
                return res.status(400).json({
                    error:
                        "Os parâmetros start e count devem ser números"
                });
            }

            const result =
                await UserModel.GetHighscore(
                    type,
                    country,
                    startNum,
                    countNum
                );

            res.json(result);
        } catch (err) {
            next(err);
        }
    }
);

app.get(
    "/social/interactions",
    SocialController.getInteractions
);

app.get(
    "/tournamentx/active",
    TournamentXController.getActive.bind(
        TournamentXController
    )
);

app.get(
    "/tournamentx/active/v2",
    TournamentXController.getActive.bind(
        TournamentXController
    )
);

app.post(
    "/tournamentx/:tournamentId/join/v2",
    TournamentXController.join.bind(
        TournamentXController
    )
);

app.post(
    "/tournamentx/:tournamentId/leave",
    TournamentXController.leave.bind(
        TournamentXController
    )
);

app.post(
    "/tournamentx/:tournamentId/finish",
    TournamentXController.finish.bind(
        TournamentXController
    )
);

app.get(
    "/api/v1/ping",
    async (req, res) => {
        res
            .status(200)
            .send("OK");
    }
);

app.post(
    "/api/v1/userLoginExternal",
    TournamentController.login
);

app.get(
    "/api/v1/tournaments",
    TournamentController.getActive
);

app.use(
    errorControll
);

app.listen(
    PORT,
    () => {
        const currentDate =
            new Date()
                .toLocaleString()
                .replace(",", " |");

        console.clear();

        Console.log(
            "Server",
            `[${Title}] | ${currentDate} | ${CryptoUtils.SessionToken()}`
        );

        Console.log(
            "Server",
            `Listening on port ${PORT}`
        );

        Console.log(
            "Maintenance",
            isMaintenanceEnabled()
                ? "ENABLED"
                : "DISABLED"
        );

        Console.log(
            "Required Version (exact)",
            getRequiredVersion()
        );
    }
);

