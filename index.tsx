/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, LiveServerMessage, Modality, Session } from '@google/genai';
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { createBlob, decode, decodeAudioData } from './utils';
import { fetchOrderById } from './puma-service';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() connected = false;

  private client: GoogleGenAI;
  private session: Session;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({ sampleRate: 16000 });
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({ sampleRate: 24000 });
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      width: 100vw;
      background-color: #121212;
      color: white;
      font-family: 'Inter', sans-serif;
    }

    h1 {
      margin-bottom: 2rem;
      font-size: 2.5rem;
      font-weight: 300;
      letter-spacing: 2px;
    }

    .controls {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }

    button {
      outline: none;
      border: 2px solid rgba(255, 255, 255, 0.1);
      color: white;
      border-radius: 50px;
      background: rgba(255, 255, 255, 0.05);
      padding: 15px 40px;
      cursor: pointer;
      font-size: 1.2rem;
      transition: all 0.3s ease;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    button:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
    }

    button:active {
      transform: translateY(0);
    }

    button.recording {
      background: rgba(200, 0, 0, 0.2);
      border-color: rgba(200, 0, 0, 0.5);
      color: #ffcccc;
    }

    #status {
      margin-top: 2rem;
      font-size: 0.9rem;
      color: rgba(255, 255, 255, 0.5);
      min-height: 1.5rem;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-native-audio-preview-12-2025';

    try {
      const toolDefinitions = [
        {
          functionDeclarations: [
            {
              name: "get_refund_status",
              description: "Get the refund status and ARN (Reference Number) for a given order ID.",
              parameters: {
                type: "OBJECT",
                properties: {
                  order_id: { type: "STRING", description: "The order ID, e.g., 12345" }
                },
                required: ["order_id"]
              }
            },
            {
              name: "get_order_status",
              description: "Get the current shipping status and delivery details of an order.",
              parameters: {
                type: "OBJECT",
                properties: {
                  order_id: { type: "STRING", description: "The order ID, e.g., 12345" }
                },
                required: ["order_id"]
              }
            }
          ]
        }
      ] as any;

      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Ready to connect');
            this.connected = true;
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio
            const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData;
            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            // Handle Tool Calls
            const toolCall = message.toolCall;
            if (toolCall) {
              const functionCalls = toolCall.functionCalls;
              const responses = [];

              for (const call of functionCalls) {
                const result = await this.handleToolCall(call.name, call.args);
                responses.push({
                  name: call.name,
                  id: call.id,
                  response: { result: result }
                });
              }

              this.session.sendToolResponse({
                functionResponses: responses
              });
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Disconnected: ' + e.reason);
            this.connected = false;
            this.isRecording = false;
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          tools: toolDefinitions,
          systemInstruction: {
            parts: [
              {
                text: `You are a helpful Support Agent for Puma India.
                When the conversation starts, say: "Thank you for calling Puma Support. I am your support agent. How can I help you today?"

                **VOICE AND PACING STRATEGY**:
                - ROLEPLAY: You are a polite, helpful Indian lady. 
                - ACCENT: Speak with a clear, soft Bangalore English accent.
                - SPEED: Speak SLOWLY and DELIBERATELY. Do not rush your sentences. 
                - PHRASING: Use local professional markers like "Kindly," "Tell me one thing," and "I will definitely help you with that, don't worry."
                - FLOW: Add slight pauses between sentences to ensure the customer understands the Order IDs and Status details.

                **RISK & COMPLIANCE (CRITICAL)**:
                - **IMMEDIATE ESCALATION**: If the user mentions "Lawyer", "Sue", "Court", "Fraud", "Scam", "Police", "Chargeback", or uses abusive language.
                - **ACTION**: Apologize and say: "I understand your concern. I have flagged this for our Senior Support Specialist who will contact you directly." Then immediately ADD: "Meanwhile, while I arrange that, I can check the refund status and your reference number so you could check with your bank."

                **OPERATIONAL POLICIES**:
                1. **CANCELLATION**: If user wants to cancel, direct them to WhatsApp. Say: "To cancel instantly, please use our WhatsApp service. I can send you the link."
                2. **ADDRESS CHANGE**:
                   - If Order is SHIPPED/DELIVERED: "I apologize, but we cannot change the delivery address once the order has been shipped. Please coordinate with the courier partner."
                   - If Order is PROCESSING: "Please provide the new address." (Then acknowledge).
                3. **STUCK ORDERS**: If an order is "Created" or "Packed" for more than 6 days without movement, apologize and state you are escalating to the Logistics Team.

                **CORE RULES**:
                1. ENGLISH ONLY.
                2. Be professional and brand-aligned with Puma.`
              },
            ],
          },
          generationConfig: {
            temperature: 0.75, // Too low and she sounds like a robot; too high and she loses the plot.
            topP: 0.95,
            topK: 40,
          },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          },
        },
      });
    } catch (e) {
      console.error(e);
      this.updateError("Failed to connect to Gemini");
    }
  }

  private async handleToolCall(name: string, args: any) {
    console.log(`Tool Call: ${name} `, args);
    this.updateStatus(`Checking ${name}...`);

    let orderId = String(args.order_id || "").trim();
    if (!orderId) return { error: "No Order ID provided" };
    // Remove potential 'PUMA-' prefix if the user spoke it but we want just digits, OR keep it.
    // The previous prompt example said "e.g., 12345", but earlier "e.g. PUMA-123456".
    // I validated "12345" works. "PUMA-12345" failures.
    // So let's arguably STRIP "PUMA-" if present just in case user says "Puma 12345".
    orderId = orderId.replace(/^puma[- ]?/i, "");

    try {
      const order = await fetchOrderById(orderId);

      if (!order) {
        return { error: `Order ${orderId} not found in our system.Please check the ID.` };
      }

      if (name === "get_order_status") {
        const status = order.status?.toLowerCase() || "processing";
        const createdAt = new Date(order.created_at);
        const ageInDays = (new Date().getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
        const isTerminal = ["delivered", "returned", "cancelled", "failed delivery"].includes(status);

        // STUCK LOGIC: > 6 days old and not terminal
        if (ageInDays > 6 && !isTerminal) {
          return {
            status: "Stuck/Delayed",
            details: order,
            action: "Escalated to Logistics Team",
            message: `We apologize.Your order ${orderId} seems to be stuck.Since it has been more than 6 days, I have escalated this to our logistics team for an immediate update.`
          };
        }

        return {
          status: status,
          details: order,
          message: `Order ${orderId} is currently ${status}.Items: ${order.items}.`
        };
      }

      if (name === "get_refund_status") {
        const refundStatus = order.refund_status || "Pending";

        if (refundStatus.toLowerCase() === "processed" || refundStatus.toLowerCase() === "success") {
          return {
            status: "Processed",
            details: order,
            message: `Refund for ${orderId} has been successfully processed.The Bank Reference Number(ARN) is ${order.refund_rrn || 'available in your statement'}. Please check with your bank.`
          };
        } else {
          return {
            status: "Pending",
            sla_info: "Refunds typically take 5-7 business days after return pickup.",
            message: `Your refund for ${orderId} is currently pending.It generally takes 5 - 7 business days.`
          };
        }
      }
    } catch (err) {
      console.error("Tool execution error:", err);
      return { error: "Failed to fetch data from backend." };
    }

    return { error: "Unknown tool" };
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.requestUpdate();
  }

  private updateError(msg: string) {
    this.error = msg;
    this.requestUpdate();
  }

  private async toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording() {
    if (this.isRecording) return;

    // Ensure context is running (needed for some browsers)
    if (this.inputAudioContext.state === 'suspended') {
      await this.inputAudioContext.resume();
    }

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Listening...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({ media: createBlob(pcmData) });
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message} `);
      this.stopRecording();
    }
  }

  private stopRecording() {
    this.updateStatus('Stopped.');
    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  render() {
    return html`
        < h1 > Puma Demo</h1 >
          <div class="controls">
            <button 
            @click=${this.toggleRecording}
            class=${this.isRecording ? 'recording' : ''}
            ?disabled=${!this.connected}
          >
            ${this.isRecording ? 'Stop / Disconnect' : 'Connect / Start'}
          </button>
        </div >
        <div id="status">${this.error || this.status}</div>
      `;
  }
}
