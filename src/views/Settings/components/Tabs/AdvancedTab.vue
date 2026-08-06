<template>
    <div class="flex flex-col gap-10 py-2">
        <SettingsGroup :title="t('view.settings.advanced.advanced.vrchat_settings.header')">
            <SettingsItem
                :label="t('view.settings.advanced.advanced.relaunch_vrchat.header')"
                :description="t('view.settings.advanced.advanced.relaunch_vrchat.description')">
                <Switch
                    :model-value="relaunchVRChatAfterCrash"
                    :ariaLabel="t('view.settings.advanced.advanced.relaunch_vrchat.header')"
                    @update:modelValue="setRelaunchVRChatAfterCrash" />
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.advanced.advanced.vrchat_quit_fix.header')"
                :description="t('view.settings.advanced.advanced.vrchat_quit_fix.description')">
                <Switch
                    :model-value="vrcQuitFix"
                    :ariaLabel="t('view.settings.advanced.advanced.vrchat_quit_fix.header')"
                    @update:modelValue="setVrcQuitFix" />
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.advanced.advanced.auto_cache_management.header')"
                :description="t('view.settings.advanced.advanced.auto_cache_management.description')">
                <Switch
                    :model-value="autoSweepVRChatCache"
                    :ariaLabel="t('view.settings.advanced.advanced.auto_cache_management.header')"
                    @update:modelValue="setAutoSweepVRChatCache" />
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.advanced.advanced.self_invite.header')"
                :description="t('view.settings.advanced.advanced.self_invite.description')">
                <Switch
                    :model-value="selfInviteOverride"
                    :ariaLabel="t('view.settings.advanced.advanced.self_invite.header')"
                    @update:modelValue="setSelfInviteOverride" />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.advanced.advanced.auto_join_group_certification.header')">
                <Switch :model-value="autoJoinGroupCertification" @update:modelValue="setAutoJoinGroupCertification" />
            </SettingsItem>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.advanced_groups.security.header')">
            <SettingsItem
                :label="t('view.settings.advanced.advanced.primary_password.header')"
                :description="t('view.settings.advanced.advanced.primary_password.description')">
                <Switch
                    :model-value="enablePrimaryPassword"
                    :disabled="!enablePrimaryPassword"
                    :ariaLabel="t('view.settings.advanced.advanced.primary_password.header')"
                    @update:modelValue="enablePrimaryPasswordChange" />
            </SettingsItem>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.general.logging.header')">
            <SettingsItem :label="t('view.settings.advanced.advanced.cache_debug.udon_exception_logging')">
                <Switch
                    :model-value="udonExceptionLogging"
                    :ariaLabel="t('view.settings.advanced.advanced.cache_debug.udon_exception_logging')"
                    @update:modelValue="setUdonExceptionLogging" />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.general.logging.resource_load')">
                <Switch
                    :model-value="logResourceLoad"
                    :ariaLabel="t('view.settings.general.logging.resource_load')"
                    @update:modelValue="setLogResourceLoad" />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.general.logging.empty_avatar')">
                <Switch
                    :model-value="logEmptyAvatars"
                    :ariaLabel="t('view.settings.general.logging.empty_avatar')"
                    @update:modelValue="setLogEmptyAvatars" />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.general.logging.auto_login_delay')">
                <Switch
                    :model-value="autoLoginDelayEnabled"
                    :ariaLabel="t('view.settings.general.logging.auto_login_delay')"
                    @update:modelValue="setAutoLoginDelayEnabled" />
            </SettingsItem>

            <SettingsItem
                v-if="autoLoginDelayEnabled"
                :label="t('view.settings.general.logging.auto_login_delay_button')">
                <Button size="sm" variant="outline" @click="promptAutoLoginDelaySeconds">
                    {{ t('view.settings.general.logging.auto_login_delay_button') }}
                </Button>
            </SettingsItem>
        </SettingsGroup>

        <template v-if="!isLinux">
            <SettingsGroup :title="t('view.settings.advanced.advanced.app_launcher.header')">
                <SettingsItem :label="t('view.settings.advanced.advanced.app_launcher.folder')">
                    <Button size="sm" variant="outline" @click="openShortcutFolder()">{{
                        t('view.settings.advanced.advanced.app_launcher.folder')
                    }}</Button>
                </SettingsItem>

                <SettingsItem
                    :label="t('view.settings.advanced.advanced.remote_database.enable')"
                    :description="t('view.settings.advanced.advanced.app_launcher.folder_tooltip')">
                    <Switch
                        :model-value="enableAppLauncher"
                        :ariaLabel="t('view.settings.advanced.advanced.remote_database.enable')"
                        @update:modelValue="setEnableAppLauncher" />
                </SettingsItem>

                <SettingsItem :label="t('view.settings.advanced.advanced.app_launcher.auto_close')">
                    <Switch
                        :model-value="enableAppLauncherAutoClose"
                        :ariaLabel="t('view.settings.advanced.advanced.app_launcher.auto_close')"
                        @update:modelValue="setEnableAppLauncherAutoClose" />
                </SettingsItem>

                <SettingsItem :label="t('view.settings.advanced.advanced.app_launcher.run_process_once')">
                    <Switch
                        :model-value="enableAppLauncherRunProcessOnce"
                        :ariaLabel="t('view.settings.advanced.advanced.app_launcher.run_process_once')"
                        @update:modelValue="setEnableAppLauncherRunProcessOnce" />
                </SettingsItem>
            </SettingsGroup>
        </template>

        <SettingsGroup :title="t('view.settings.advanced.advanced.launch_commands.header')">
            <SettingsItem
                :label="t('view.settings.advanced.advanced.launch_commands.show_confirmation_on_switch_avatar_enable')"
                :description="
                    t('view.settings.advanced.advanced.launch_commands.show_confirmation_on_switch_avatar_tooltip')
                ">
                <Switch
                    :model-value="showConfirmationOnSwitchAvatar"
                    :ariaLabel="
                        t('view.settings.advanced.advanced.launch_commands.show_confirmation_on_switch_avatar_enable')
                    "
                    @update:modelValue="setShowConfirmationOnSwitchAvatar" />
            </SettingsItem>

            <div class="flex gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    @click="openExternalLink('https://github.com/yixijun/VRCX-Luo/wiki/Launch-parameters-&-VRCX.json')"
                    >{{ t('view.settings.advanced.advanced.launch_commands.docs') }}</Button
                >
                <Button
                    size="sm"
                    variant="outline"
                    @click="openExternalLink('https://github.com/Myrkie/open-in-vrcx')"
                    >{{ t('view.settings.advanced.advanced.launch_commands.website_userscript') }}</Button
                >
            </div>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.advanced.advanced.cache_debug.header')">
            <div class="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" @click="clearVRCXCache">{{
                    t('view.settings.advanced.advanced.cache_debug.clear_cache')
                }}</Button>
                <Button size="sm" variant="outline" @click="promptAutoClearVRCXCacheFrequency">{{
                    t('view.settings.advanced.advanced.cache_debug.auto_clear_cache')
                }}</Button>
                <Button size="sm" variant="outline" @click="refreshCacheSize">{{
                    t('view.settings.advanced.advanced.cache_debug.refresh_cache')
                }}</Button>
            </div>

            <SettingsItem
                :label="`${t('view.settings.advanced.advanced.cache_debug.disable_gamelog')} ${t('view.settings.advanced.advanced.cache_debug.disable_gamelog_notice')}`">
                <Switch
                    :model-value="gameLogDisabled"
                    :ariaLabel="t('view.settings.advanced.advanced.cache_debug.disable_gamelog')"
                    @update:modelValue="disableGameLogDialog()" />
            </SettingsItem>

            <div class="flex flex-col gap-1 text-sm">
                <span
                    >{{ t('view.settings.advanced.advanced.cache_debug.user_cache') }}
                    <span v-text="cacheSize.cachedUsers"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.cache_debug.world_cache') }}
                    <span v-text="cacheSize.cachedWorlds"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.cache_debug.avatar_cache') }}
                    <span v-text="cacheSize.cachedAvatars"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.cache_debug.group_cache') }}
                    <span v-text="cacheSize.cachedGroups"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.cache_debug.avatar_name_cache') }}
                    <span v-text="cacheSize.cachedAvatarNames"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.cache_debug.instance_cache') }}
                    <span v-text="cacheSize.cachedInstances"></span
                ></span>
            </div>

            <SettingsItem :label="t('view.settings.advanced.advanced.cache_debug.show_console')">
                <Button size="sm" variant="outline" @click="showConsole">{{
                    t('view.settings.advanced.advanced.cache_debug.show_console')
                }}</Button>
            </SettingsItem>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.advanced_groups.database.header')">
            <SettingsItem :label="t('view.settings.advanced.advanced.sqlite_table_size.refresh')">
                <Button size="sm" variant="outline" @click="getSqliteTableSizes">{{
                    t('view.settings.advanced.advanced.sqlite_table_size.refresh')
                }}</Button>
            </SettingsItem>

            <div class="flex flex-col gap-1 text-sm">
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.gps') }}
                    <span v-text="sqliteTableSizes.gps"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.status') }}
                    <span v-text="sqliteTableSizes.status"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.bio') }}
                    <span v-text="sqliteTableSizes.bio"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.avatar') }}
                    <span v-text="sqliteTableSizes.avatar"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.online_offline') }}
                    <span v-text="sqliteTableSizes.onlineOffline"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.friend_log_history') }}
                    <span v-text="sqliteTableSizes.friendLogHistory"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.notification') }}
                    <span v-text="sqliteTableSizes.notification"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.location') }}
                    <span v-text="sqliteTableSizes.location"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.join_leave') }}
                    <span v-text="sqliteTableSizes.joinLeave"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.portal_spawn') }}
                    <span v-text="sqliteTableSizes.portalSpawn"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.video_play') }}
                    <span v-text="sqliteTableSizes.videoPlay"></span
                ></span>
                <span
                    >{{ t('view.settings.advanced.advanced.sqlite_table_size.event') }}
                    <span v-text="sqliteTableSizes.event"></span
                ></span>
            </div>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.advanced_groups.database_engine.header')">
            <SettingsItem
                :label="t('view.settings.advanced.advanced.database_engine.mode')"
                :description="t('view.settings.advanced.advanced.database_engine.mode_description')">
                <Select :model-value="databaseEngine" @update:modelValue="onDatabaseEngineChange">
                    <SelectTrigger class="w-40">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value="sqlite">
                                {{ t('view.settings.advanced.advanced.database_engine.mode_sqlite') }}
                            </SelectItem>
                            <SelectItem value="postgresql">
                                {{ t('view.settings.advanced.advanced.database_engine.mode_postgresql') }}
                            </SelectItem>
                            <SelectItem value="mysql">
                                {{ t('view.settings.advanced.advanced.database_engine.mode_mysql') }}
                            </SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </SettingsItem>

            <Alert variant="warning" class="mb-1">
                <TriangleAlert />
                <AlertDescription>
                    {{ t('view.settings.advanced.advanced.database_engine.restart_hint') }}
                </AlertDescription>
            </Alert>

            <template v-if="databaseEngine === 'sqlite'">
                <SettingsItem
                    :label="t('view.settings.advanced.advanced.database_engine.sqlite_path')"
                    :description="t('view.settings.advanced.advanced.database_engine.sqlite_path_description')">
                    <div class="flex items-center gap-2 w-full">
                        <Input
                            v-model="sqlitePath"
                            class="w-72"
                            :placeholder="
                                t('view.settings.advanced.advanced.database_engine.sqlite_path_placeholder')
                            " />
                        <Button size="sm" variant="outline" @click="onBrowseSqliteFolder">
                            <FolderOpen class="h-4 w-4 mr-1" />
                            {{ t('view.settings.advanced.advanced.database_engine.browse_folder_button') }}
                        </Button>
                        <Button size="sm" variant="outline" @click="onBrowseSqliteFile">
                            <FileUp class="h-4 w-4 mr-1" />
                            {{ t('view.settings.advanced.advanced.database_engine.browse_file_button') }}
                        </Button>
                    </div>
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.test_connection')">
                    <div class="flex items-center gap-2 w-full">
                        <Button
                            size="sm"
                            :variant="
                                sqliteConnectionStatus === 'connected'
                                    ? 'default'
                                    : sqliteConnectionStatus === 'failed'
                                      ? 'destructive'
                                      : 'outline'
                            "
                            :class="
                                sqliteConnectionStatus === 'connected'
                                    ? 'bg-green-600 hover:bg-green-600 text-white'
                                    : sqliteConnectionStatus === 'failed'
                                      ? 'bg-red-600 hover:bg-red-600 text-white'
                                      : ''
                            "
                            :disabled="sqliteConnectionStatus === 'testing'"
                            @click="onTestSqliteConnection">
                            <Loader2 v-if="sqliteConnectionStatus === 'testing'" class="h-4 w-4 mr-1 animate-spin" />
                            {{ t('view.settings.advanced.advanced.database_engine.test_connection_button') }}
                        </Button>
                        <span v-if="sqliteConnectionStatus === 'connected'" class="text-green-500 text-sm truncate">
                            {{ t('view.settings.advanced.advanced.database_engine.test_connection_ok') }}
                        </span>
                        <span
                            v-if="sqliteConnectionStatus === 'failed' && sqliteConnectionError"
                            class="text-red-500 text-sm truncate max-w-md"
                            :title="sqliteConnectionError">
                            {{ sqliteConnectionError }}
                        </span>
                    </div>
                </SettingsItem>
            </template>

            <template v-if="databaseEngine === 'postgresql'">
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.pg_host')">
                    <Input v-model="pgsqlHost" class="w-60" />
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.pg_port')">
                    <Input v-model.number="pgsqlPort" type="number" class="w-24" />
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.pg_username')">
                    <Input v-model="pgsqlUsername" class="w-40" />
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.pg_password')">
                    <Input v-model="pgsqlPassword" type="password" class="w-40" />
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.pg_database')">
                    <Input v-model="pgsqlDatabase" class="w-40" />
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.test_connection')">
                    <div class="flex items-center gap-2 w-full">
                        <Button
                            size="sm"
                            :variant="
                                pgsqlConnectionStatus === 'connected'
                                    ? 'default'
                                    : pgsqlConnectionStatus === 'failed'
                                      ? 'destructive'
                                      : 'outline'
                            "
                            :class="
                                pgsqlConnectionStatus === 'connected'
                                    ? 'bg-green-600 hover:bg-green-600 text-white'
                                    : pgsqlConnectionStatus === 'failed'
                                      ? 'bg-red-600 hover:bg-red-600 text-white'
                                      : ''
                            "
                            :disabled="pgsqlConnectionStatus === 'testing'"
                            @click="onTestPgsqlConnection">
                            <Loader2 v-if="pgsqlConnectionStatus === 'testing'" class="h-4 w-4 mr-1 animate-spin" />
                            {{ t('view.settings.advanced.advanced.database_engine.test_connection_button') }}
                        </Button>
                        <span v-if="pgsqlConnectionStatus === 'connected'" class="text-green-500 text-sm truncate">
                            {{ t('view.settings.advanced.advanced.database_engine.test_connection_ok') }}
                        </span>
                        <span
                            v-if="pgsqlConnectionStatus === 'failed' && pgsqlConnectionError"
                            class="text-red-500 text-sm truncate max-w-md"
                            :title="pgsqlConnectionError">
                            {{ pgsqlConnectionError }}
                        </span>
                    </div>
                </SettingsItem>
                <SettingsItem
                    :label="t('view.settings.advanced.advanced.database_engine.migrate')"
                    :description="t('view.settings.advanced.advanced.database_engine.migrate_hint')">
                    <div class="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            :disabled="pgsqlPushStatus === 'pushing' || !pgPushGuard.ok"
                            :title="pgPushGuard.message"
                            @click="openPushDialog('postgresql')">
                            {{ t('view.settings.advanced.advanced.database_engine.migrate_button') }}
                        </Button>
                        <span v-if="pgsqlPushStatus === 'pushing'" class="text-yellow-500">…</span>
                        <span v-if="pgsqlPushStatus === 'done'" class="text-green-500">✓</span>
                        <span v-if="pgsqlPushStatus === 'failed'" class="text-red-500">✗</span>
                    </div>
                </SettingsItem>
                <SettingsItem
                    :label="t('view.settings.advanced.advanced.database_engine.backup')"
                    :description="t('view.settings.advanced.advanced.database_engine.backup_hint')">
                    <div class="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            :disabled="pullStatus === 'pulling' || !pullGuard.ok"
                            :title="pullGuard.message"
                            @click="onPullToSqlite">
                            <DatabaseBackup class="h-4 w-4 mr-1" />
                            {{ t('view.settings.advanced.advanced.database_engine.backup_button') }}
                        </Button>
                        <span v-if="pullStatus === 'pulling'" class="text-yellow-500">…</span>
                        <span v-if="pullStatus === 'done'" class="text-green-500">✓</span>
                        <span v-if="pullStatus === 'failed'" class="text-red-500">✗</span>
                    </div>
                </SettingsItem>
            </template>

            <template v-else-if="databaseEngine === 'mysql'">
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.mysql_host')">
                    <Input v-model="mysqlHost" class="w-60" />
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.mysql_port')">
                    <Input v-model.number="mysqlPort" type="number" class="w-24" />
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.mysql_username')">
                    <Input v-model="mysqlUsername" class="w-40" />
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.mysql_password')">
                    <Input v-model="mysqlPassword" type="password" class="w-40" />
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.mysql_database')">
                    <Input v-model="mysqlDatabase" class="w-40" />
                </SettingsItem>
                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.test_connection')">
                    <div class="flex items-center gap-2 w-full">
                        <Button
                            size="sm"
                            :variant="
                                mysqlConnectionStatus === 'connected'
                                    ? 'default'
                                    : mysqlConnectionStatus === 'failed'
                                      ? 'destructive'
                                      : 'outline'
                            "
                            :class="
                                mysqlConnectionStatus === 'connected'
                                    ? 'bg-green-600 hover:bg-green-600 text-white'
                                    : mysqlConnectionStatus === 'failed'
                                      ? 'bg-red-600 hover:bg-red-600 text-white'
                                      : ''
                            "
                            :disabled="mysqlConnectionStatus === 'testing'"
                            @click="onTestMysqlConnection">
                            <Loader2 v-if="mysqlConnectionStatus === 'testing'" class="h-4 w-4 mr-1 animate-spin" />
                            {{ t('view.settings.advanced.advanced.database_engine.test_connection_button') }}
                        </Button>
                        <span v-if="mysqlConnectionStatus === 'connected'" class="text-green-500 text-sm truncate">
                            {{ t('view.settings.advanced.advanced.database_engine.test_connection_ok') }}
                        </span>
                        <span
                            v-if="mysqlConnectionStatus === 'failed' && mysqlConnectionError"
                            class="text-red-500 text-sm truncate max-w-md"
                            :title="mysqlConnectionError">
                            {{ mysqlConnectionError }}
                        </span>
                    </div>
                </SettingsItem>
                <SettingsItem
                    :label="t('view.settings.advanced.advanced.database_engine.migrate')"
                    :description="t('view.settings.advanced.advanced.database_engine.migrate_hint')">
                    <div class="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            :disabled="mysqlPushStatus === 'pushing' || !mysqlPushGuard.ok"
                            :title="mysqlPushGuard.message"
                            @click="openPushDialog('mysql')">
                            {{ t('view.settings.advanced.advanced.database_engine.migrate_button') }}
                        </Button>
                        <span v-if="mysqlPushStatus === 'pushing'" class="text-yellow-500">…</span>
                        <span v-if="mysqlPushStatus === 'done'" class="text-green-500">✓</span>
                        <span v-if="mysqlPushStatus === 'failed'" class="text-red-500">✗</span>
                    </div>
                </SettingsItem>
                <SettingsItem
                    :label="t('view.settings.advanced.advanced.database_engine.backup')"
                    :description="t('view.settings.advanced.advanced.database_engine.backup_hint')">
                    <div class="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            :disabled="pullStatus === 'pulling' || !pullGuard.ok"
                            :title="pullGuard.message"
                            @click="onPullToSqlite">
                            <DatabaseBackup class="h-4 w-4 mr-1" />
                            {{ t('view.settings.advanced.advanced.database_engine.backup_button') }}
                        </Button>
                        <span v-if="pullStatus === 'pulling'" class="text-yellow-500">…</span>
                        <span v-if="pullStatus === 'done'" class="text-green-500">✓</span>
                        <span v-if="pullStatus === 'failed'" class="text-red-500">✗</span>
                    </div>
                </SettingsItem>
            </template>
        </SettingsGroup>

        <Dialog
            :open="isPushDialogVisible"
            @update:open="
                (open) => {
                    if (!open) isPushDialogVisible = false;
                }
            ">
            <DialogContent class="x-dialog sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{{ t('view.settings.advanced.advanced.database_engine.migrate') }}</DialogTitle>
                </DialogHeader>

                <Alert variant="warning" class="mb-3">
                    <TriangleAlert />
                    <AlertDescription>
                        {{ t('view.settings.advanced.advanced.database_engine.migrate_hint') }}
                    </AlertDescription>
                </Alert>

                <Alert v-if="!pushDialogGuard.ok" variant="destructive" class="mb-3">
                    <TriangleAlert />
                    <AlertDescription>
                        {{ t('view.settings.advanced.advanced.database_engine.restart_hint') }}
                        <span v-if="pushDialogGuard.message" class="block mt-1 text-xs opacity-90">{{
                            pushDialogGuard.message
                        }}</span>
                    </AlertDescription>
                </Alert>

                <SettingsItem :label="t('view.settings.advanced.advanced.database_engine.push_source_label')">
                    <div class="flex items-center gap-2 w-full">
                        <Input
                            v-model="pushSourcePath"
                            class="flex-1 min-w-0"
                            :placeholder="t('view.settings.advanced.advanced.database_engine.push_source_placeholder')" />
                        <Button size="sm" variant="outline" @click="onBrowsePushSource">
                            <FileUp class="h-4 w-4 mr-1" />
                            {{ t('view.settings.advanced.advanced.database_engine.browse_file_button') }}
                        </Button>
                    </div>
                </SettingsItem>

                <DialogFooter>
                    <Button variant="outline" size="sm" @click="isPushDialogVisible = false">
                        {{ t('confirm.cancel_button') }}
                    </Button>
                    <Button
                        size="sm"
                        :disabled="
                            (pushTargetEngine === 'postgresql'
                                ? pgsqlPushStatus === 'pushing'
                                : mysqlPushStatus === 'pushing') || !pushDialogGuard.ok
                        "
                        @click="handlePush">
                        {{ t('view.settings.advanced.advanced.database_engine.migrate_button') }}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <SettingsGroup :title="t('view.settings.advanced.advanced.database_cleanup.header')">
            <SettingsItem
                :label="t('view.settings.advanced.advanced.database_cleanup.auto_cleanup')"
                :description="t('view.settings.advanced.advanced.database_cleanup.auto_cleanup_description')">
                <Select :model-value="avatarAutoCleanup" @update:modelValue="setAvatarAutoCleanup">
                    <SelectTrigger class="w-36">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value="Off">{{
                                t('view.settings.advanced.advanced.database_cleanup.auto_cleanup_off')
                            }}</SelectItem>
                            <SelectItem value="30">{{
                                t('view.settings.advanced.advanced.database_cleanup.auto_cleanup_30')
                            }}</SelectItem>
                            <SelectItem value="90">{{
                                t('view.settings.advanced.advanced.database_cleanup.auto_cleanup_90')
                            }}</SelectItem>
                            <SelectItem value="180">{{
                                t('view.settings.advanced.advanced.database_cleanup.auto_cleanup_180')
                            }}</SelectItem>
                            <SelectItem value="365">{{
                                t('view.settings.advanced.advanced.database_cleanup.auto_cleanup_365')
                            }}</SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </SettingsItem>

            <SettingsItem :label="t('view.settings.advanced.advanced.database_cleanup.purge_button')">
                <Button size="sm" variant="outline" @click="isPurgeDialogVisible = true">
                    <Trash2 class="h-4 w-4 mr-1" />
                    {{ t('view.settings.advanced.advanced.database_cleanup.purge') }}
                </Button>
            </SettingsItem>
        </SettingsGroup>

        <Dialog
            :open="isPurgeDialogVisible"
            @update:open="
                (open) => {
                    if (!open) isPurgeDialogVisible = false;
                }
            ">
            <DialogContent class="x-dialog sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{{
                        t('view.settings.advanced.advanced.database_cleanup.purge_confirm_title')
                    }}</DialogTitle>
                </DialogHeader>

                <Alert variant="warning" class="mb-3">
                    <TriangleAlert />
                    <AlertDescription>
                        {{ t('view.settings.advanced.advanced.database_cleanup.purge_confirm_alert') }}
                    </AlertDescription>
                </Alert>

                <div class="flex flex-col gap-1 text-sm text-muted-foreground mb-3">
                    <p>{{ t('view.settings.advanced.advanced.database_cleanup.purge_confirm_description_1') }}</p>
                    <p>{{ t('view.settings.advanced.advanced.database_cleanup.purge_confirm_description_2') }}</p>
                    <p>{{ t('view.settings.advanced.advanced.database_cleanup.purge_confirm_description_3') }}</p>
                </div>

                <SettingsItem :label="t('view.settings.advanced.advanced.database_cleanup.purge_older_than')">
                    <Select v-model="selectedPurgePeriod">
                        <SelectTrigger class="w-36">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="180">{{
                                    t('view.settings.advanced.advanced.database_cleanup.purge_option_180')
                                }}</SelectItem>
                                <SelectItem value="365">{{
                                    t('view.settings.advanced.advanced.database_cleanup.purge_option_365')
                                }}</SelectItem>
                                <SelectItem value="730">{{
                                    t('view.settings.advanced.advanced.database_cleanup.purge_option_730')
                                }}</SelectItem>
                                <SelectItem value="all">{{
                                    t('view.settings.advanced.advanced.database_cleanup.purge_option_all')
                                }}</SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </SettingsItem>

                <DialogFooter>
                    <Button variant="outline" size="sm" @click="isPurgeDialogVisible = false">
                        {{ t('confirm.cancel_button') }}
                    </Button>
                    <Button size="sm" variant="destructive" :disabled="purgeInProgress" @click="handlePurge">
                        <Trash2 class="h-4 w-4 mr-1" />
                        {{ t('view.settings.advanced.advanced.database_cleanup.purge_confirm_button') }}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <SettingsGroup :title="t('view.settings.advanced_groups.diagnostics.header')">
            <SettingsItem :label="t('view.profile.game_info.online_users')">
                <div class="flex items-center gap-2">
                    <span v-if="visits !== null" class="text-sm text-muted-foreground">{{
                        t('view.profile.game_info.user_online', { count: visits })
                    }}</span>
                    <Button size="sm" variant="outline" @click="getVisits">{{ t('common.actions.refresh') }}</Button>
                </div>
            </SettingsItem>

            <SettingsItem :label="t('view.profile.config_json')">
                <div class="flex items-center gap-2">
                    <Button size="sm" variant="outline" @click="refreshConfigTreeData()">{{
                        t('common.actions.refresh')
                    }}</Button>
                    <Button
                        v-if="Object.keys(configTreeData).length > 0"
                        size="sm"
                        variant="outline"
                        @click="configTreeData = {}"
                        >{{ t('common.actions.clear') }}</Button
                    >
                </div>
            </SettingsItem>
            <vue-json-pretty
                v-if="Object.keys(configTreeData).length > 0"
                :data="configTreeData"
                :deep="2"
                :theme="isDarkMode ? 'dark' : 'light'"
                :height="800"
                :dynamic-height="false"
                virtual
                show-icon />
        </SettingsGroup>

        <template v-if="branch === 'Nightly'">
            <SettingsGroup :title="t('view.settings.advanced_groups.nightly.header')">
                <SettingsItem
                    :label="t('view.settings.advanced.advanced.anonymous_error_reporting.header')"
                    :description="t('view.settings.advanced.advanced.anonymous_error_reporting.description')">
                    <Switch :model-value="sentryErrorReporting" @update:modelValue="setSentryErrorReporting()" />
                </SettingsItem>
            </SettingsGroup>
        </template>

        <RegistryBackupDialog />
        <PhotonSettings v-if="photonLoggingEnabled" />
    </div>
</template>

<script setup>
    import { Trash2, TriangleAlert, FolderOpen, FileUp, Loader2, DatabaseBackup } from 'lucide-vue-next';
    import { computed, onMounted, reactive, ref } from 'vue';
    import Noty from 'noty';
    import { Button } from '@/components/ui/button';
    import { Switch } from '@/components/ui/switch';
    import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
    import { Input } from '@/components/ui/input';
    import { Alert, AlertDescription } from '@/components/ui/alert';
    import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import VueJsonPretty from 'vue-json-pretty';

    import {
        useAdvancedSettingsStore,
        useAppearanceSettingsStore,
        useAuthStore,
        useAvatarStore,
        useGeneralSettingsStore,
        useGroupStore,
        useInstanceStore,
        usePhotonStore,
        useUiStore,
        useUserStore,
        useVRCXUpdaterStore,
        useWorldStore
    } from '@/stores';
    import { authRequest, queryRequest } from '@/api';
    import { disableGameLogDialog } from '@/coordinators/gameLogCoordinator';
    import { clearVRCXCache } from '@/coordinators/vrcxCoordinator';
    import { openExternalLink } from '@/shared/utils';

    import PhotonSettings from '../PhotonSettings.vue';
    import RegistryBackupDialog from '../../../Tools/dialogs/RegistryBackupDialog.vue';
    import SettingsGroup from '../SettingsGroup.vue';
    import SettingsItem from '../SettingsItem.vue';

    const { t } = useI18n();

    const advancedSettingsStore = useAdvancedSettingsStore();
    const { enablePrimaryPasswordChange } = useAuthStore();
    const { cachedConfig } = storeToRefs(useAuthStore());
    const { showConsole } = useUiStore();

    const generalSettingsStore = useGeneralSettingsStore();
    const { udonExceptionLogging, logResourceLoad, logEmptyAvatars, autoLoginDelayEnabled } =
        storeToRefs(generalSettingsStore);
    const {
        setUdonExceptionLogging,
        setLogResourceLoad,
        setLogEmptyAvatars,
        setAutoLoginDelayEnabled,
        promptAutoLoginDelaySeconds
    } = generalSettingsStore;

    const { cachedUsers } = useUserStore();
    const { cachedWorlds } = useWorldStore();
    const { cachedAvatars, cachedAvatarNames } = useAvatarStore();
    const { cachedGroups } = useGroupStore();
    const { cachedInstances } = useInstanceStore();

    const { photonLoggingEnabled } = storeToRefs(usePhotonStore());
    const { branch } = storeToRefs(useVRCXUpdaterStore());

    const { isDarkMode } = storeToRefs(useAppearanceSettingsStore());

    const {
        enablePrimaryPassword,
        relaunchVRChatAfterCrash,
        vrcQuitFix,
        autoSweepVRChatCache,
        selfInviteOverride,
        enableAppLauncher,
        enableAppLauncherAutoClose,
        enableAppLauncherRunProcessOnce,
        showConfirmationOnSwitchAvatar,
        gameLogDisabled,
        sqliteTableSizes,
        avatarAutoCleanup,
        purgeInProgress,
        sentryErrorReporting,
        autoJoinGroupCertification,
        databaseEngine,
        pgsqlHost,
        pgsqlPort,
        pgsqlUsername,
        pgsqlPassword,
        pgsqlDatabase,
        pgsqlConnectionStatus,
        pgsqlPushStatus,
        mysqlHost,
        mysqlPort,
        mysqlUsername,
        mysqlPassword,
        mysqlDatabase,
        mysqlConnectionStatus,
        mysqlPushStatus,
        pullStatus,
        sqlitePath,
        sqliteConnectionStatus,
        sqliteConnectionError
    } = storeToRefs(advancedSettingsStore);

    const {
        setRelaunchVRChatAfterCrash,
        setVrcQuitFix,
        setAutoSweepVRChatCache,
        setSelfInviteOverride,
        setEnableAppLauncher,
        setEnableAppLauncherAutoClose,
        setEnableAppLauncherRunProcessOnce,
        setShowConfirmationOnSwitchAvatar,
        getSqliteTableSizes,
        setAvatarAutoCleanup,
        purgeAvatarFeedData,
        promptAutoClearVRCXCacheFrequency,
        setSentryErrorReporting,
        setAutoJoinGroupCertification,
        loadDatabaseEngineConfig,
        saveDatabaseEngineConfig,
        testPgsqlConnection,
        testMysqlConnection,
        testSqliteConnection,
        browseSqlitePath,
        browseSqliteFolder,
        pushFromSqliteToPgsql,
        pushFromSqliteToMysql,
        pickPushSourcePath,
        canPushToRemote,
        pullToSqlite,
        canPullFromRemote,
        resolveCurrentSqliteDbPath
    } = advancedSettingsStore;

    const configTreeData = ref({});
    const visits = ref(null);
    const selectedPurgePeriod = ref('180');
    const isPurgeDialogVisible = ref(false);
    const isPushDialogVisible = ref(false);
    /**
     * Which remote engine the push confirmation dialog is targeting.
     * Set by the push buttons (`'postgresql'` / `'mysql'`) before opening
     * the dialog, then read by `handlePush` to dispatch to the right store
     * action. Defaults to `'postgresql'` for backward compatibility with the
     * original PgSQL-only flow.
     * @type {import('vue').Ref<'postgresql' | 'mysql'>}
     */
    const pushTargetEngine = ref('postgresql');

    /**
     * SQLite source file for the push migration dialog. Empty = use the
     * store fallback (derived default location) when submitting.
     */
    const pushSourcePath = ref('');
    /** In-flight prefill promise; awaited by handlePush to avoid racing. @type {Promise<void>|null} */
    let pushSourcePrefill = null;

    /**
     * Open the push confirmation dialog for the given target engine and
     * prefill the source SQLite path (best-effort; failure never blocks).
     * @param {'postgresql'|'mysql'} engine
     */
    function openPushDialog(engine) {
        pushTargetEngine.value = engine;
        isPushDialogVisible.value = true;
        pushSourcePrefill = prefillPushSource().catch(() => {});
    }

    /** Best-effort prefill: current sqlitePath (adhoc window) or derived default. */
    async function prefillPushSource() {
        try {
            pushSourcePath.value =
                sqlitePath.value || (await resolveCurrentSqliteDbPath());
        } catch {
            // Keep the current input value.
        }
    }

    // Pre-flight guard for the push buttons (defect 3 fix). The push
    // destination is the live singleton adapter, whose connection was fixed
    // at boot; the form refs may have been edited without a restart.
    // `canPushToRemote` compares the form against the boot-time snapshot and
    // the runtime engine, returning `{ ok, message }`. These computeds track
    // the matching set of refs so the button disabled-state updates live as
    // the user edits host/port/etc. The runtime `adapter.engineType` is
    // non-reactive but never changes mid-session, so it does not need to be
    // in the dependency graph.
    /** @type {import('vue').ComputedRef<{ ok: boolean, message: string }>} */
    const pgPushGuard = computed(() => canPushToRemote('postgresql'));
    /** @type {import('vue').ComputedRef<{ ok: boolean, message: string }>} */
    const mysqlPushGuard = computed(() => canPushToRemote('mysql'));
    /** Guard for whichever engine the open confirmation dialog targets. */
    const pushDialogGuard = computed(() =>
        pushTargetEngine.value === 'mysql' ? mysqlPushGuard.value : pgPushGuard.value
    );
    /** Pre-flight guard for the remote → SQLite pull button. Returns
     * `{ ok, message }` from `canPullFromRemote` — ok only when the live
     * adapter booted in a remote engine (postgresql or mysql). */
    /** @type {import('vue').ComputedRef<{ ok: boolean, message: string }>} */
    const pullGuard = computed(() => canPullFromRemote());

    const cacheSize = reactive({
        cachedUsers: 0,
        cachedWorlds: 0,
        cachedAvatars: 0,
        cachedGroups: 0,
        cachedAvatarNames: 0,
        cachedInstances: 0
    });

    const isLinux = computed(() => LINUX);

    function handlePurge() {
        const days = selectedPurgePeriod.value === 'all' ? null : parseInt(selectedPurgePeriod.value, 10);
        isPurgeDialogVisible.value = false;
        purgeAvatarFeedData(days);
    }

    /**
     *
     */
    function openShortcutFolder() {
        AppApi.OpenShortcutFolder();
    }

    /**
     *
     */
    function refreshCacheSize() {
        cacheSize.cachedUsers = cachedUsers.size;
        cacheSize.cachedWorlds = cachedWorlds.size;
        cacheSize.cachedAvatars = cachedAvatars.size;
        cacheSize.cachedGroups = cachedGroups.size;
        cacheSize.cachedAvatarNames = cachedAvatarNames.size;
        cacheSize.cachedInstances = cachedInstances.size;
    }

    /**
     *
     */
    async function refreshConfigTreeData() {
        await authRequest.getConfig();
        configTreeData.value = cachedConfig.value;
    }

    /**
     *
     */
    function getVisits() {
        queryRequest.fetch('visits').then((args) => {
            visits.value = args.json;
        });
    }

    // ── Phase 9 §6.2 — Database engine selection + migration handlers ──
    /**
     * Persist the newly selected engine mode. A restart is required for the
     * C# layer to re-Init the chosen backend; we don't switch adapters at
     * runtime. For sqlite we persist the current `sqlitePath` ref; for
     * remote engines we persist the matching remote config.
     * @param {string} value
     */
    async function onDatabaseEngineChange(value) {
        const prev = databaseEngine.value;
        databaseEngine.value = value;
        try {
            if (value === 'sqlite') {
                await saveDatabaseEngineConfig('sqlite', null, {
                    sqlitePath: sqlitePath.value
                });
            } else {
                await saveDatabaseEngineConfig(value, remoteConfigFor(value));
            }
        } catch (err) {
            console.error('Failed to save database engine config:', err);
            databaseEngine.value = prev;
        }
    }

    /**
     * Build the remote config object for the given engine mode by reading the
     * matching set of refs ({@code pg*} vs {@code mysql*}). Centralised so the
     * change / test-connection / migrate handlers all read the same fields.
     * Returns `null` for sqlite — sqlite has no remote config, its path is
     * handled separately through the `sqlitePath` ref.
     * @param {string} engine - 'postgresql' | 'mysql' | 'sqlite'
     * @returns {{host: string, port: number, username: string, password: string, database: string} | null}
     */
    function remoteConfigFor(engine) {
        if (engine === 'mysql' || engine === 'mariadb') {
            return {
                host: mysqlHost.value,
                port: mysqlPort.value,
                username: mysqlUsername.value,
                password: mysqlPassword.value,
                database: mysqlDatabase.value
            };
        }
        if (engine === 'sqlite') {
            return null;
        }
        return {
            host: pgsqlHost.value,
            port: pgsqlPort.value,
            username: pgsqlUsername.value,
            password: pgsqlPassword.value,
            database: pgsqlDatabase.value
        };
    }

    /** Probe the PG backend health and surface the result via the status ref. */
    async function onTestPgsqlConnection() {
        // Persist current fields first so the C# layer (on next restart) uses
        // the latest values; the live probe runs against the already-Init'd
        // connection from the current boot.
        try {
            await saveDatabaseEngineConfig(databaseEngine.value, remoteConfigFor('postgresql'));
        } catch (err) {
            console.warn('saveDatabaseEngineConfig before test failed:', err);
        }
        await testPgsqlConnection();
    }

    /**
     * Probe the MySQL/MariaDB backend health. Symmetric to
     * `onTestPgsqlConnection`; persists the current MySQL fields first so the
     * next boot uses the latest values, then calls the live probe.
     */
    async function onTestMysqlConnection() {
        try {
            await saveDatabaseEngineConfig(databaseEngine.value, remoteConfigFor('mysql'));
        } catch (err) {
            console.warn('saveDatabaseEngineConfig before test failed:', err);
        }
        await testMysqlConnection();
    }

    /**
     * Open the native folder picker for the SQLite database location. The
     * store appends `\VRCX.sqlite3` and canonicalizes the result.
     */
    async function onBrowseSqliteFolder() {
        await browseSqliteFolder();
    }

    /**
     * Open the native file picker for an existing SQLite database file.
     */
    async function onBrowseSqliteFile() {
        await browseSqlitePath();
    }

    /**
     * Open the native file picker for the push dialog's source SQLite file.
     * The picked path is kept in the local `pushSourcePath` ref; nothing in
     * the store is touched.
     */
    async function onBrowsePushSource() {
        const picked = await pickPushSourcePath();
        if (picked) pushSourcePath.value = picked;
    }

    /**
     * Probe the SQLite database file by new-ing a throwaway adapter in
     * read-write mode. Persists the current path first so a subsequent
     * restart uses the probed path, then runs the probe. If the file does
     * not exist it is created (proving the directory is writable); if it
     * exists it is opened and validated as a SQLite database.
     */
    async function onTestSqliteConnection() {
        try {
            await saveDatabaseEngineConfig('sqlite', null, {
                sqlitePath: sqlitePath.value
            });
        } catch (err) {
            console.warn('saveDatabaseEngineConfig before test failed:', err);
        }
        await testSqliteConnection();
    }

    /**
    /**
     * Close the confirmation dialog and kick off the push, dispatched by
     * `pushTargetEngine`. Mirrors the `handlePurge` /
     * `isPushDialogVisible` pattern used for avatar feed purging so the
     * user must confirm before a destructive operation.
     */
    async function handlePush() {
        if (pushSourcePrefill) await pushSourcePrefill;
        pushSourcePrefill = null;
        isPushDialogVisible.value = false;
        onPush();
    }

    /**
     * Run the SQLite to remote (PostgreSQL or MySQL) push. Dispatched by
     * `pushTargetEngine`; the destination is the live singleton adapter,
     * which is the matching remote adapter only after the user switched
     * engine + restarted. If they have not, the store action will throw with
     * a clear message. Noty notifications surface the outcome in the UI in
     * addition to the console log.
     */
    async function onPush() {
        const storeAction = pushTargetEngine.value === 'mysql' ? pushFromSqliteToMysql : pushFromSqliteToPgsql;
        const srcConnStr = pushSourcePath.value ? `sqlite:///${pushSourcePath.value}` : undefined;
        try {
            const result = await storeAction(srcConnStr);
            if (result.errors.length > 0) {
                console.warn('Migration completed with errors:');
                for (const err of result.errors) {
                    console.warn(`  ${err}`);
                }
                new Noty({
                    type: 'warning',
                    text: `Migration done: ${result.globalTables} global tables, ${result.userTables} user tables, ${result.rowsCopied} rows copied, ${result.errors.length} error(s). Check console (F12) for details.`
                }).show();
            } else {
                new Noty({
                    type: 'success',
                    text: `Migration done: ${result.globalTables} global tables, ${result.userTables} user tables, ${result.rowsCopied} rows copied`
                }).show();
            }
            console.log(
                `Migration done: ${result.globalTables} global tables, ` +
                    `${result.userTables} user tables, ` +
                    `${result.rowsCopied} rows copied, ` +
                    `${result.errors.length} errors.`
            );
        } catch (err) {
            console.error('Migration failed:', err);
            new Noty({
                type: 'error',
                text: `Migration failed: ${err.message || err}`
            }).show();
        }
    }

    /**
     * Pull the live remote database (PostgreSQL or MySQL) to a NEW
     * `.sqlite3` file the user picks via a native Save-As dialog. The
     * store action opens the dialog, validates the extension, and runs
     * `pullToSqlite`. Noty notifications surface the outcome in
     * the UI in addition to the console log. A cancelled Save-As dialog
     * is a no-op (no notification).
     */
    async function onPullToSqlite() {
        try {
            const result = await pullToSqlite();
            // `undefined` means the user cancelled the Save-As dialog —
            // no notification, no log entry.
            if (!result) return;
            if (result.errors.length > 0) {
                console.warn('Backup completed with errors:');
                for (const err of result.errors) {
                    console.warn(`  ${err}`);
                }
                new Noty({
                    type: 'warning',
                    text: `Backup done: ${result.globalTables} global tables, ${result.userTables} user tables, ${result.rowsCopied} rows copied, ${result.errors.length} error(s). Check console (F12) for details.`
                }).show();
            } else {
                new Noty({
                    type: 'success',
                    text: `Backup done: ${result.globalTables} global tables, ${result.userTables} user tables, ${result.rowsCopied} rows copied`
                }).show();
            }
            console.log(
                `Backup done: ${result.globalTables} global tables, ` +
                    `${result.userTables} user tables, ` +
                    `${result.rowsCopied} rows copied, ` +
                    `${result.errors.length} errors.`
            );
        } catch (err) {
            console.error('Backup failed:', err);
            new Noty({
                type: 'error',
                text: `Backup failed: ${err.message || err}`
            }).show();
        }
    }

    onMounted(() => {
        loadDatabaseEngineConfig();
    });
</script>
