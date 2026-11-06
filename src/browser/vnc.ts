import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface VNCDisplaySession {
  displayNumber: number;
  vncPort: number;
  novncPort: number;
  novncUrl: string;
  xvfbProcess?: ChildProcess;
  x11vncProcess?: ChildProcess;
  websockifyProcess?: ChildProcess;
}

export class VNCManager {
  private activeDisplays: Map<string, VNCDisplaySession> = new Map();
  private nextDisplayOffset = 0;

  /**
   * Allocates an isolated Xvfb + x11vnc + websockify (noVNC bridge) environment for this user's session.
   * On Linux/Docker, spins up real virtual framebuffers. On Windows dev, falls back gracefully.
   */
  public async allocateDisplay(sessionId: string): Promise<VNCDisplaySession> {
    // If already allocated
    if (this.activeDisplays.has(sessionId)) {
      return this.activeDisplays.get(sessionId)!;
    }

    const offset = this.nextDisplayOffset++;
    const displayNumber = config.browser.displayBase + offset;
    const vncPort = config.browser.vncPortBase + offset;
    const novncPort = config.browser.novncPortBase + offset;

    const novncUrl = `${config.browser.novncPublicBaseUrl}:${novncPort}/vnc.html?autoconnect=true&resize=scale`;

    const isLinux = os.platform() === 'linux';

    let xvfbProcess: ChildProcess | undefined;
    let x11vncProcess: ChildProcess | undefined;
    let websockifyProcess: ChildProcess | undefined;

    if (isLinux) {
      try {
        // 1. Start Xvfb virtual framebuffer on DISPLAY :<displayNumber>
        xvfbProcess = spawn('Xvfb', [`:${displayNumber}`, '-screen', '0', '1280x800x24', '-ac'], {
          stdio: 'ignore',
          detached: true,
        });

        // 2. Start x11vnc server attached to this Xvfb display
        x11vncProcess = spawn(
          'x11vnc',
          [
            '-display',
            `:${displayNumber}`,
            '-rfbport',
            vncPort.toString(),
            '-shared',
            '-forever',
            '-nopw',
            '-quiet',
          ],
          { stdio: 'ignore', detached: true }
        );

        // 3. Start websockify for noVNC browser client access
        websockifyProcess = spawn(
          'websockify',
          ['--web', '/usr/share/novnc', novncPort.toString(), `localhost:${vncPort}`],
          { stdio: 'ignore', detached: true }
        );

        logger.info(
          `Started Linux isolated VNC stack for session ${sessionId} on Display :${displayNumber}, VNC:${vncPort}, noVNC:${novncPort}`
        );
      } catch (err: any) {
        logger.error(`Error spawning VNC stack on Linux: ${err.message}`);
      }
    } else {
      logger.info(
        `Non-Linux environment (${os.platform()}): Simulated VNC allocated for session ${sessionId} (Port: ${novncPort})`
      );
    }

    const sessionData: VNCDisplaySession = {
      displayNumber,
      vncPort,
      novncPort,
      novncUrl,
      xvfbProcess,
      x11vncProcess,
      websockifyProcess,
    };

    this.activeDisplays.set(sessionId, sessionData);
    return sessionData;
  }

  /**
   * Terminate and clean up display resources
   */
  public cleanupDisplay(sessionId: string) {
    const sessionData = this.activeDisplays.get(sessionId);
    if (!sessionData) return;

    try {
      if (sessionData.websockifyProcess && !sessionData.websockifyProcess.killed) {
        sessionData.websockifyProcess.kill();
      }
      if (sessionData.x11vncProcess && !sessionData.x11vncProcess.killed) {
        sessionData.x11vncProcess.kill();
      }
      if (sessionData.xvfbProcess && !sessionData.xvfbProcess.killed) {
        sessionData.xvfbProcess.kill();
      }
      logger.info(`Cleaned up VNC display :${sessionData.displayNumber} for session ${sessionId}`);
    } catch (err: any) {
      logger.warn(`Error cleaning up VNC display: ${err.message}`);
    } finally {
      this.activeDisplays.delete(sessionId);
    }
  }

  public getDisplay(sessionId: string): VNCDisplaySession | undefined {
    return this.activeDisplays.get(sessionId);
  }
}

export const vncManager = new VNCManager();
