import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, type onAuthenticatePayload, type onStoreDocumentPayload, type onConnectPayload, type onDisconnectPayload, onLoadDocumentPayload } from '@hocuspocus/server';
import { CollaboratorsService } from '../collaborators/collaborators.service';
import { JwtService } from '@nestjs/jwt';
import { SlidesService } from '../slides/slides.service';
import { PERMISSIONS } from '../common/constants/permissions';
import * as Y from 'yjs';
// 内存中存储共享文档连接信息
interface SharedDocConnection {
    slideId: number;
    docName: string;
    createdAt: Date;
}

@Injectable()
export class SharedDocService implements OnModuleInit, OnModuleDestroy {
    private server: Server;
    private readonly logger = new Logger(SharedDocService.name);
    // 内存存储：slideId -> 连接信息
    private sharedDocs = new Map<number, SharedDocConnection>();

    constructor(
        private collaboratorsService: CollaboratorsService,
        private jwtService: JwtService,
        private slidesService: SlidesService,
        private configService: ConfigService,
    ) { }

    async onModuleInit() {
        // return;
        const self = this;

        const wsBaseUrl = this.configService.get<string>('WS_BASE_URL', 'ws://localhost');
        const wsBasePort = this.configService.get<string>('WS_BASE_PORT', '1234');

        this.server = new Server({
            port: parseInt(wsBasePort, 10),
            async onLoadDocument(data: onLoadDocumentPayload) {
                const docName = data.documentName;
                const slideId = self.extractSlideIdFromDocName(docName);
                if (!slideId) {
                    throw new Error('无效的文档名称');
                }
                const slide = await self.slidesService.findById(slideId);
                if (!slide) {
                    throw new Error('文档不存在');
                }
                const doc = new Y.Doc();
                const yText = doc.getText('codemirror');
                if (slide.content) {
                    yText.insert(0, slide.content);
                }
                return doc;
            },
            // 文档存储钩子：持久化到数据库以及服务器对应文件
            async onStoreDocument(data: onStoreDocumentPayload) {
                try {
                    const doc = data.document;
                    const textType = doc.getText('codemirror');
                    const content = textType.toString();
                    const docName = data.documentName;
                    // 提取 slideId 从 docName (格式: slide-{id})
                    const slideId = self.extractSlideIdFromDocName(docName);
                    if (slideId) {
                        await self.saveDocumentContent(slideId, content);
                    }
                } catch (error) {
                    throw error;
                }
            },

            // 认证钩子：验证 JWT Token
            async onAuthenticate(data: onAuthenticatePayload) {
                const { token, documentName } = data;

                self.logger.debug(`[Hocuspocus] 认证请求: ${documentName}`);

                if (!token) {
                    throw new Error('未提供认证令牌');
                }

                try {
                    const payload = self.jwtService.verify(token);
                    const userId = payload.sub || payload.userId;

                    const slideId = self.extractSlideIdFromDocName(documentName);
                    if (!slideId) {
                        throw new Error('无效的文档名称');
                    }

                    const { role } = await self.collaboratorsService.getMyRole(slideId, userId);
                    if (!role) {
                        throw new Error('没有访问权限');
                    }

                    const userPermissions = PERMISSIONS[role];
                    const canEdit = userPermissions.includes('edit');
                    const canRead = userPermissions.includes('read');

                    if (!canRead) {
                        throw new Error('没有读取权限');
                    }
                    if (!canEdit) {
                        self.logger.warn(`[Hocuspocus] 用户 ${userId} 没有编辑权限`);
                        data.connectionConfig.readOnly = true;
                    }
                    return {
                        userId: userId.toString(),
                        readOnly: !canEdit,
                    };
                } catch (error) {
                    self.logger.error('[Hocuspocus] 认证失败:', error.message);
                    throw new Error('认证失败: ' + error.message);
                }
            },

            // 连接钩子
            async onConnect(data: onConnectPayload) {
                // 加载文档内容
                const docName = data.documentName;
                const content = await self.slidesService.findById(parseInt(docName.split('-')[1], 10));
                self.logger.log(`[Hocuspocus] 客户端连接: ${data.documentName}`);
            },

            // 断开连接钩子
            async onDisconnect(data: onDisconnectPayload) {
                // 当文档10min之内没有人在线时，关闭slide
                // setTimeout(() => {
                //   if (data.clientsCount === 0) {
                //     const slideId = self.extractSlideIdFromDocName(data.documentName);
                //     if (slideId) {
                //       self.slidesService.stopDev(slideId);
                //     }
                //   }
                // }, 600000); // 10min
                self.logger.log(`[Hocuspocus] 客户端断开: ${data.documentName}`);
            },
        });

        await this.server.listen();
        this.logger.log('[Hocuspocus] 服务器已启动，监听端口: 1234');
    }

    async onModuleDestroy() {
        if (this.server) {
            await this.server.destroy();
            this.logger.log('[Hocuspocus] 服务器已关闭');
        }
    }

    /**
     * 从文档名称提取 slideId
     * 格式: slide-{id}
     */
    private extractSlideIdFromDocName(docName: string): number | null {
        const match = docName.match(/^slide-(\d+)$/);
        if (match) {
            return parseInt(match[1], 10);
        }
        return null;
    }

    private async saveDocumentContent(slideId: number, content: string): Promise<void> {
        await this.slidesService.saveContent(slideId, { content });
        this.logger.debug(`[Hocuspocus] 文档 ${slideId} 内容已保存到数据库`);
    }

    /**
     * 获取或创建共享文档（内存存储）
     */
    async getOrCreateSharedDoc(slideId: number): Promise<SharedDocConnection> {
        let sharedDoc = this.sharedDocs.get(slideId);

        if (!sharedDoc) {
            sharedDoc = {
                slideId,
                docName: `slide-${slideId}`,
                createdAt: new Date(),
            };
            this.sharedDocs.set(slideId, sharedDoc);
            this.logger.debug(`[SharedDoc] 创建内存文档记录: slide-${slideId}`);
        }

        return sharedDoc;
    }

    /**
     * 获取文档连接信息
     */
    async getConnectionInfo(slideId: number, userId: number): Promise<{
        url: string;
        docName: string;
        token: string;
    }> {
        const docName = `slide-${slideId}`;

        // 生成 JWT token 用于 WebSocket 认证
        const token = this.jwtService.sign({
            sub: userId,
            slideId,
        });
        const wsBaseUrl = this.configService.get<string>('WS_BASE_URL', 'ws://localhost');
        const wsBasePort = this.configService.get<string>('WS_BASE_PORT', '1234');
        const wsUrl = `${wsBaseUrl}:${wsBasePort}`;
        return {
            url: wsUrl,
            docName,
            token,
        };
    }
}
