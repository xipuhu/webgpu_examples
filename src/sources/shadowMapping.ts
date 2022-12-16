import shadowVertex from "../shaders/shadowMapping/shadow.vertex.wgsl?raw"
import shadowFrag from "../shaders/shadowMapping/shadow.frag.wgsl?raw"
import shadowDepth from "../shaders/shadowMapping/shadowDepth.vertex.wgsl?raw"

import * as sphere from "../util/sphere"
import * as box from "../util/box"
import { getModelViewMatrix, getProjectionMatrix } from "../util/math";
import { mat4, vec3 } from "gl-matrix"

// 物体数量
const NUM = 30;

// 初始化WebGPU
async function initWebGPU(canvas: HTMLCanvasElement) {
    // 判断当前设备是否支持WebGPU
    if (!navigator.gpu) throw new Error("Not Support WebGPU");
    // 请求Adapter对象，GPU在浏览器中的抽象代理
    const adapter = await navigator.gpu.requestAdapter({
        /* 电源偏好
            high-performance 高性能电源管理
            low-power 节能电源管理模式 
        */
        powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("No Adapter Found");
    //请求GPU设备
    const device = await adapter.requestDevice();
    //获取WebGPU上下文对象
    const context = canvas.getContext("webgpu") as GPUCanvasContext;
    //获取浏览器默认的颜色格式
    const format = navigator.gpu.getPreferredCanvasFormat();
    //设备分辨率
    const devicePixelRatio = window.devicePixelRatio || 1;
    //canvas尺寸
    const presentationSize = {
        width: canvas.clientWidth * devicePixelRatio,
        height: canvas.clientHeight * devicePixelRatio,
    };
    canvas.width = presentationSize.width;
    canvas.height =presentationSize.height;
    //配置WebGPU
    context.configure({
        device,
        format,
        // Alpha合成模式，opaque为不透明
        alphaMode: "opaque",
    });

    return { device, context, format, presentationSize };
}

// 创建渲染管线
async function initPipeline(
    device: GPUDevice,
    format: GPUTextureFormat
) {
    const vertexBuffers: Iterable<GPUVertexBufferLayout> = [{
        arrayStride: 8 * 4, // 3 position 2 uv,
        attributes: [
            {
                // position
                shaderLocation: 0,
                offset: 0,
                format: 'float32x3',
            },
            {
                // normal
                shaderLocation: 1,
                offset: 3 * 4,
                format: 'float32x3',
            },
            {
                // uv
                shaderLocation: 2,
                offset: 6 * 4,
                format: 'float32x2',
            },
        ]
    }];
    const primitive = {
        topology: 'triangle-list',
        cullMode: 'back'
    };
    const depthStencil = {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth32float',
    };

    const shadowPipeline = await device.createRenderPipelineAsync({
        label: 'Shadow Pipeline',
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({
                code: shadowDepth,
            }),
            entryPoint: 'main',
            buffers: vertexBuffers
        },
        primitive, depthStencil
    } as GPURenderPipelineDescriptor);

    const renderPipeline = await device.createRenderPipelineAsync({
        label: 'Render Target Pipeline',
        layout: "auto",
        // 顶点着色器
        vertex: {
            module: device.createShaderModule({
                code: shadowVertex,
            }),
            entryPoint: "main",
            buffers: vertexBuffers
        },
        // 片元着色器
        fragment: {
            module: device.createShaderModule({
                code: shadowFrag,
            }),
            entryPoint: "main",
            targets: [
                {
                    format: format,
                }
            ],
        },
        primitive, depthStencil
    } as GPURenderPipelineDescriptor);

    return {shadowPipeline, renderPipeline};
}

// 创建所需的vertexBuffer、indexBuffer、uniformBuffer和bindGroup
async function createResources(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    pipelineObj: {
        shadowPipeline: GPURenderPipeline
        renderPipeline: GPURenderPipeline
    }
) {
    // 创建object的vertexBuffer和indexBuffer
    const boxBuffer = {
        vertex: device.createBuffer({
            label: "GPUBuffer store vertex",
            size: box.vertex.byteLength,
            usage:
                GPUBufferUsage.VERTEX |
                GPUBufferUsage.COPY_DST
        }),
        index: device.createBuffer({
            label: "GPUBuffer store vertex index",
            size: box.index.byteLength,
            usage:
                GPUBufferUsage.INDEX |
                GPUBufferUsage.COPY_DST
        })
    };
    const sphereBuffer = {
        vertex: device.createBuffer({
            label: "GPUBuffer store vertex",
            size: sphere.vertex.byteLength,
            usage:
                GPUBufferUsage.VERTEX |
                GPUBufferUsage.COPY_DST
        }),
        index: device.createBuffer({
            label: "GPUBuffer store vertex index",
            size: sphere.index.byteLength,
            usage:
                GPUBufferUsage.INDEX |
                GPUBufferUsage.COPY_DST
        })
    };
    device.queue.writeBuffer(boxBuffer.vertex, 0, box.vertex);
    device.queue.writeBuffer(boxBuffer.index, 0, box.index);
    device.queue.writeBuffer(sphereBuffer.vertex, 0, sphere.vertex);
    device.queue.writeBuffer(sphereBuffer.index, 0, sphere.index);

    // 1. 创建depthTexture
    const presentationSize = {
        width: canvas.clientWidth * devicePixelRatio,
        height: canvas.clientHeight * devicePixelRatio,
    };
    // for shadowPass
    const shadowDepthTexture = device.createTexture({
        size: [2048, 2048],
        format: 'depth32float',
        usage:
            GPUTextureUsage.RENDER_ATTACHMENT | 
            GPUTextureUsage.TEXTURE_BINDING
    });
    // for renderPass
    const renderDepthTexture = device.createTexture({
        size: presentationSize,
        format: 'depth32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    
    // 2. 创建depthTextureView
    const shadowDepthView = shadowDepthTexture.createView();
    const renderDepthView = renderDepthTexture.createView();

    // 3. 创建存储model matrix
    const modelViewBuffer = device.createBuffer({
        label: "GPUBuffer sotre n*4x4 matrix",
        size: 4 * 4 * 4 * NUM, // 4 x 4 x float32 x NUM
        usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST
    });
    // 4. 创建camera projection matrix
    const cameraProjectionBuffer = device.createBuffer({
        label: "GPUBuffer sotre 4x4 matrix",
        size: 4 * 4 * 4, // 4 x 4 x float32
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });
    // 5. 从light的角度创建light projecttion martix用于渲染shadowMap
    const lightProjectionBuffer = device.createBuffer({
        label: "GPUBuffer sotre 4x4 matrix",
        size: 4 * 4 * 4, // 4 x 4 x float32
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });
    // 6. 创建obj color buffer
    const colorBuffer = device.createBuffer({
        label: "GPUBuffer sotre n*4 color",
        size: 4 * 4 * NUM, // 4 x float32 x NUM
        usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST
    });
    // 7. 创建平行光的uniform buffer
    const lightBuffer = device.createBuffer({
        label: 'GPUBuffer store 4x4 matrix',
        size: 4 * 4,
        usage:
            GPUBufferUsage.UNIFORM | 
            GPUBufferUsage.COPY_DST
    })

    // 8. 创建需要绑定在renderPipeline上的binding group
    const vsGroup = device.createBindGroup({
        label: "Uniform Group with matrix",
        layout: pipelineObj.renderPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: modelViewBuffer
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: cameraProjectionBuffer
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: lightProjectionBuffer
                }
            },
            {
                binding: 3,
                resource: {
                    buffer: colorBuffer
                }
            }
        ]
    });
    const fsGroup = device.createBindGroup({
        label: 'Group for fragment',
        layout: pipelineObj.renderPipeline.getBindGroupLayout(1),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: lightBuffer
                }
            },
            {
                binding: 1,
                resource: shadowDepthView
            },
            {
                binding: 2,
                resource: device.createSampler({
                    compare: 'less'
                })
            }
        ]
    });

    // 9. 创建需要绑定在shadowPipeline上的binding group
    const shadowGroup = device.createBindGroup({
        label: 'binding group for shadowPass',
        layout: pipelineObj.shadowPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: modelViewBuffer
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: lightProjectionBuffer
                }
            }
        ]
    })

    return {boxBuffer, sphereBuffer, 
            modelViewBuffer, cameraProjectionBuffer, lightProjectionBuffer, colorBuffer, lightBuffer,
            vsGroup, fsGroup, shadowGroup,
            renderDepthTexture, renderDepthView, shadowDepthTexture, shadowDepthView};
}

// 编写绘图指令，并传递给本地的GPU设备
function draw(
    device: GPUDevice,
    context: GPUCanvasContext,
    pipelineObj: {
        shadowPipeline: GPURenderPipeline,
        renderPipeline: GPURenderPipeline
    },
    resourcesObj: {
        boxBuffer: {vertex: GPUBuffer, index: GPUBuffer},
        sphereBuffer: {vertex: GPUBuffer, index: GPUBuffer},
        modelViewBuffer: GPUBuffer,
        cameraProjectionBuffer: GPUBuffer,
        lightProjectionBuffer: GPUBuffer,
        colorBuffer: GPUBuffer,
        lightBuffer: GPUBuffer,
        vsGroup: GPUBindGroup,
        fsGroup: GPUBindGroup,
        shadowGroup: GPUBindGroup,
        renderDepthView: GPUTextureView,
        shadowDepthView: GPUTextureView
    }
) {
    // 创建所有object的model matrix
    const scene: any[] = [];
    const modelViewMatrix = new Float32Array(NUM * 4 * 4);
    const colorBuffer = new Float32Array(NUM * 4);

    // 地板中心的立方体柱子
    {
        const position = {x: 0, y: 0, z: -20};
        const rotation = {x: 0, y: Math.PI / 4, z: 0};
        const scale = {x: 2, y: 20, z: 2};
        const modelView = getModelViewMatrix(position, rotation, scale);
        modelViewMatrix.set(modelView, 0 * 4 * 4);
        colorBuffer.set([0.5, 0.5, 0.5, 1], 0 * 4);
        scene.push({position, rotation, scale});
    }
    // 地板
    {
        const position = {x: 0, y: -10, z: -20};
        const rotation = {x: 0, y: 0, z: 0};
        const scale = {x: 50, y: 0.5, z: 40};
        const modelView = getModelViewMatrix(position, rotation, scale);
        modelViewMatrix.set(modelView, 1 * 4 * 4);
        colorBuffer.set([1, 1, 1, 1], 1 * 4);
        scene.push({position, rotation, scale});
    }
    // 小球
    for (let i = 2; i < NUM; ++i) {
        const or = Math.random() > 0.5 ? 1 : -1;
        const position = {x: (1 + Math.random() * 12) * or, y: -8 + Math.random() * 15, z: -20 + (1 + Math.random() * 12) * or};
        const rotation = {x: Math.random(), y: Math.random(), z: Math.random()};
        const s = Math.max(0.5, Math.random());
        const scale = {x: s, y: s, z: s};
        const modelView = getModelViewMatrix(position, rotation, scale);
        modelViewMatrix.set(modelView, i * 4 * 4);
        // 给每一个object设置随机颜色值
        colorBuffer.set([Math.random(), Math.random(), Math.random(), 1], i * 4);
        scene.push({position, rotation, scale, y: position.y, v: Math.max(0.09, Math.random() / 10) * or});
    }
    device.queue.writeBuffer(resourcesObj.colorBuffer, 0, colorBuffer);

    // 初始化平行光属性
    const lightViewMatrix = mat4.create();
    const lightProjectionMatrix = mat4.create();
    const lightPosition = vec3.fromValues(0, 100, 0);
    const up = vec3.fromValues(0, 1, 0);
    const origin = vec3.fromValues(0, 0, 0);

    // 每帧需更新的数据可以在该接口中实现更新
    function frame(){
        // 更新光源数据
        const now = performance.now();
        lightPosition[0] = Math.sin(now / 1500) * 50;
        lightPosition[2] = Math.cos(now / 1500) * 50;
        mat4.lookAt(lightViewMatrix, lightPosition, origin, up);
        mat4.ortho(lightProjectionMatrix, -40, 40, -40, 40, -50, 200);
        mat4.multiply(lightProjectionMatrix, lightProjectionMatrix, lightViewMatrix);
        device.queue.writeBuffer(resourcesObj.lightProjectionBuffer, 0, lightProjectionMatrix as Float32Array);
        device.queue.writeBuffer(resourcesObj.lightBuffer, 0, lightPosition as Float32Array);

        // 更新小球位置
        for (let i = 2; i < NUM; ++i) {
            const obj = scene[i];
            obj.position.y += obj.v;
            if (obj.position.y < -9 || obj.position.y > 9) {
                obj.v *= -1;
            }
            const modelView = getModelViewMatrix(obj.position, obj.rotation, obj.scale);
            modelViewMatrix.set(modelView, i * 4 * 4);
        }
        device.queue.writeBuffer(resourcesObj.modelViewBuffer, 0, modelViewMatrix);

        const commandEncoder = device.createCommandEncoder();
        // shadow pass
        {
            // shadow pass descriptor
            const shadowPassDescriptor: GPURenderPassDescriptor = {
                colorAttachments: [],
                depthStencilAttachment: {
                    // shadowPass输出的结果为shadowMap，并传入给renderPass中的fragment shader使用
                    view: resourcesObj.shadowDepthView,
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store'
                }
            };
            const shadowPass = commandEncoder.beginRenderPass(shadowPassDescriptor);
            shadowPass.setPipeline(pipelineObj.shadowPipeline);
            shadowPass.setBindGroup(0, resourcesObj.shadowGroup);
            // set box vertex
            shadowPass.setVertexBuffer(0, resourcesObj.boxBuffer.vertex);
            shadowPass.setIndexBuffer(resourcesObj.boxBuffer.index, 'uint16');
            shadowPass.drawIndexed(box.indexCount, 2, 0, 0, 0);
            // set sphere vertex
            shadowPass.setVertexBuffer(0, resourcesObj.sphereBuffer.vertex);
            shadowPass.setIndexBuffer(resourcesObj.sphereBuffer.index, 'uint16');
            shadowPass.drawIndexed(sphere.indexCount, NUM - 2, 0, 0, NUM / 2);
            shadowPass.end();
        }
        // render pass
        {
            // render pass descriptor
            const renderPassDescriptor: GPURenderPassDescriptor = {
                colorAttachments: [
                    {
                        view: context.getCurrentTexture().createView(),
                        loadOp: "clear", // clear/load
                        clearValue: { r: 0.2, g: 0.3, b: 0.3, a: 1.0 },
                        storeOp: "store", // store/discard
                    },
                ],
                // depthStencil attachment
                depthStencilAttachment: {
                    view: resourcesObj.renderDepthView,
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                }
            };
            const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
            renderPass.setPipeline(pipelineObj.renderPipeline);
            renderPass.setBindGroup(0, resourcesObj.vsGroup);
            renderPass.setBindGroup(1, resourcesObj.fsGroup);
            // set box vertex
            renderPass.setVertexBuffer(0, resourcesObj.boxBuffer.vertex);
            renderPass.setIndexBuffer(resourcesObj.boxBuffer.index, 'uint16');
            renderPass.drawIndexed(box.indexCount, 2, 0, 0, 0);
            // set sphere vertex
            renderPass.setVertexBuffer(0, resourcesObj.sphereBuffer.vertex);
            renderPass.setIndexBuffer(resourcesObj.sphereBuffer.index, 'uint16');
            renderPass.drawIndexed(sphere.indexCount, NUM - 2, 0, 0, NUM / 2);
            renderPass.end();
        }
        device.queue.submit([commandEncoder.finish()]);

        // 用于帧刷新（需递归调用）
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

async function run() {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("No Canvas");
    // init WebGPU
    const { device, context, format, presentationSize } = await initWebGPU(canvas);
    // render pipeline
    const pipelineObj = await initPipeline(device, format);
    // create all resources
    const resourcesObj = await createResources(device, canvas, pipelineObj);
    // draw call
    draw(device, context, pipelineObj, resourcesObj);

    // update camera
    function updateCamera(){
        const aspect = presentationSize.width / presentationSize.height;
        const projectionMatrix = getProjectionMatrix(aspect, 60 / 180 * Math.PI, 0.1, 1000, {x: 0, y: 10, z: 20});
        device.queue.writeBuffer(resourcesObj.cameraProjectionBuffer, 0, projectionMatrix);
    }

    updateCamera();

    // resize window that need to update render
    window.addEventListener("resize", () => {
        presentationSize.width = canvas.width=canvas.clientWidth * devicePixelRatio;
        presentationSize.width = canvas.height=canvas.clientHeight * devicePixelRatio;
        resourcesObj.renderDepthTexture.destroy();
        resourcesObj.renderDepthTexture = device.createTexture({
            size: presentationSize, format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        resourcesObj.renderDepthView = resourcesObj.renderDepthTexture.createView();
        draw(device, context, pipelineObj, resourcesObj);
        updateCamera();
    })
}

run();
