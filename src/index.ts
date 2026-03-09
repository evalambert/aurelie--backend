import type { Core } from '@strapi/strapi';

export default {
    register({ strapi }: { strapi: Core.Strapi }) {
        const applyTo = ['api::exhibition.exhibition', 'api::atlas.atlas'];

        strapi.documents.use(async (context: any, next: any) => {
            // Évite une boucle infinie quand on fait des updates depuis ce middleware
            if (context.params?.data?._skipSyncRelations) {
                strapi.log.debug(
                    '[i18n-relations] Skip middleware because of _skipSyncRelations flag'
                );
                delete context.params.data._skipSyncRelations;
                return next();
            }
            strapi.log.debug('[i18n-relations] Middleware triggered', {
                uid: context.uid,
                action: context.action,
            });
            if (!applyTo.includes(context.uid)) {
                strapi.log.debug(
                    '[i18n-relations] UID not in applyTo, skipping',
                    { uid: context.uid }
                );
                return next();
            }

            if (!['create', 'update'].includes(context.action)) {
                strapi.log.debug(
                    '[i18n-relations] Action not create/update, skipping',
                    {
                        action: context.action,
                    }
                );
                return next();
            }

            const result = await next();

            const locale = context.params.locale;
            if (!locale) {
                strapi.log.debug(
                    '[i18n-relations] No locale in params, skipping'
                );
                return result;
            }

            const defaultLocale = await strapi
                .plugin('i18n')
                .service('locales')
                .getDefaultLocale();

            if (locale === defaultLocale) {
                strapi.log.debug(
                    '[i18n-relations] Locale is default locale, no sync needed',
                    { locale, defaultLocale }
                );
                return result;
            }

            const documentId =
                (context.params as any).documentId ??
                (result as any).documentId ??
                (result as any).id;
            if (!documentId) {
                strapi.log.warn(
                    '[i18n-relations] No documentId found, aborting sync'
                );
                return result;
            }

            strapi.log.debug('[i18n-relations] Start sync', {
                uid: context.uid,
                documentId,
                locale,
                defaultLocale,
            });

            if (context.uid === 'api::exhibition.exhibition') {
                await syncExhibitionAtlasRelations(
                    strapi,
                    documentId,
                    locale,
                    defaultLocale
                );
            }

            if (context.uid === 'api::atlas.atlas') {
                await syncAtlasRelations(
                    strapi,
                    documentId,
                    locale,
                    defaultLocale
                );
            }

            return result;
        });

        async function syncExhibitionAtlasRelations(
            strapi: Core.Strapi,
            documentId: string,
            targetLocale: string,
            defaultLocale: string
        ) {
            strapi.log.debug(
                '[i18n-relations] syncExhibitionAtlasRelations called',
                {
                    documentId,
                    targetLocale,
                    defaultLocale,
                }
            );
            const source = await strapi
                .documents('api::exhibition.exhibition')
                .findOne({
                    documentId,
                    locale: defaultLocale,
                    populate: { atlasRelation: true },
                });

            if (!source || !Array.isArray((source as any).atlasRelation)) {
                strapi.log.debug(
                    '[i18n-relations] No source exhibition or no atlasRelation array, nothing to sync'
                );
                return;
            }

            const atlasIdsToConnect: string[] = [];

            for (const atlas of (source as any).atlasRelation) {
                const atlasDocId = (atlas as any).documentId;
                if (!atlasDocId) continue;

                const localizedAtlas = await strapi
                    .documents('api::atlas.atlas')
                    .findOne({ documentId: atlasDocId, locale: targetLocale });

                if (localizedAtlas) {
                    atlasIdsToConnect.push((localizedAtlas as any).id);
                } else {
                    strapi.log.debug(
                        '[i18n-relations] No localized atlas found for',
                        {
                            atlasDocId,
                            targetLocale,
                        }
                    );
                }
            }

            if (!atlasIdsToConnect.length) {
                strapi.log.debug(
                    '[i18n-relations] No localized atlas to connect for this exhibition'
                );
                return;
            }

            strapi.log.debug(
                '[i18n-relations] Updating exhibition atlasRelation',
                {
                    documentId,
                    targetLocale,
                    atlasIdsToConnect,
                }
            );

            const exhibitionUpdateData: any = {
                _skipSyncRelations: true,
                atlasRelation: {
                    set: atlasIdsToConnect,
                },
            };

            await strapi.documents('api::exhibition.exhibition').update({
                documentId,
                locale: targetLocale,
                data: exhibitionUpdateData,
            });
        }

        async function syncAtlasRelations(
            strapi: Core.Strapi,
            documentId: string,
            targetLocale: string,
            defaultLocale: string
        ) {
            strapi.log.debug('[i18n-relations] syncAtlasRelations called', {
                documentId,
                targetLocale,
                defaultLocale,
            });
            const source = await strapi.documents('api::atlas.atlas').findOne({
                documentId,
                locale: defaultLocale,
                populate: { medium: true, territory: true },
            });

            if (!source) {
                strapi.log.debug(
                    '[i18n-relations] No source atlas found, nothing to sync'
                );
                return;
            }

            const data: Record<string, unknown> = {};

            // medium
            const medium = (source as any).medium;
            if (medium) {
                const mediumDocId = (medium as any).documentId;
                if (mediumDocId) {
                    const localizedMedium = await strapi
                        .documents('api::medium.medium')
                        .findOne({
                            documentId: mediumDocId,
                            locale: targetLocale,
                        });

                    if (localizedMedium) {
                        data.medium = { set: [(localizedMedium as any).id] };
                        strapi.log.debug(
                            '[i18n-relations] Found localized medium',
                            {
                                mediumDocId,
                                localizedId: (localizedMedium as any).id,
                            }
                        );
                    } else {
                        strapi.log.debug(
                            '[i18n-relations] No localized medium found',
                            {
                                mediumDocId,
                                targetLocale,
                            }
                        );
                    }
                }
            }

            // territory (adapte le UID si nécessaire)
            const territory = (source as any).territory;
            if (territory) {
                const territoryDocId = (territory as any).documentId;
                if (territoryDocId) {
                    const localizedTerritory = await strapi
                        .documents('api::territory.territory')
                        .findOne({
                            documentId: territoryDocId,
                            locale: targetLocale,
                        });

                    if (localizedTerritory) {
                        data.territory = {
                            set: [(localizedTerritory as any).id],
                        };
                        strapi.log.debug(
                            '[i18n-relations] Found localized territory',
                            {
                                territoryDocId,
                                localizedId: (localizedTerritory as any).id,
                            }
                        );
                    } else {
                        strapi.log.debug(
                            '[i18n-relations] No localized territory found',
                            {
                                territoryDocId,
                                targetLocale,
                            }
                        );
                    }
                }
            }

            if (!Object.keys(data).length) {
                strapi.log.debug(
                    '[i18n-relations] No medium/territory to update for this atlas'
                );
                return;
            }

            strapi.log.debug('[i18n-relations] Updating atlas relations', {
                documentId,
                targetLocale,
                data,
            });

            const atlasUpdateData: any = {
                _skipSyncRelations: true,
                ...data,
            };

            await strapi.documents('api::atlas.atlas').update({
                documentId,
                locale: targetLocale,
                data: atlasUpdateData,
            });
        }
    },

    bootstrap(/* { strapi }: { strapi: Core.Strapi } */) {},
};
