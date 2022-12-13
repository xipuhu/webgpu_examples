import objVert from "../shaders/base_lighting2/base_lighting.vert.wgsl?raw"
import objFrag from "../shaders/base_lighting2/base_lighting.frag.wgsl?raw"

import * as sphere from "../util/sphere"
import * as box from "../util/box"
import { getModelViewMatrix, getProjectionMatrix } from "../util/math";

// 物体数量
const NUM = 500; 

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
): Promise<GPURenderPipeline> {
    const descriptor: GPURenderPipelineDescriptor = {
        // 顶点着色器
        vertex: {
            module: device.createShaderModule({
                code: objVert,
            }),
            entryPoint: "main",
            buffers: [
                {
                    arrayStride: 8 * 4,  // position和normal各需要3个float32存储，UV坐标需要2个float32存储
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
                        }
                    ]
                }
            ]
        },
        // 片元着色器
        fragment: {
            module: device.createShaderModule({
                code: objFrag,
            }),
            entryPoint: "main",
            targets: [
                {
                    format: format,
                },
            ],
        },
        primitive: {
            topology: "triangle-list",
            cullMode: "back",
        },
        // 使能深度测试
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: "less",
            format: "depth24plus",
        },
        // 渲染管线的布局
        layout: "auto",
    };
    return await device.createRenderPipelineAsync(descriptor);
}

// 创建所需的vertexBuffer、indexBuffer、uniformBuffer和bindGroup
async function createResources(
    device: GPUDevice,
    pipeline: GPURenderPipeline,
    canvas: HTMLCanvasElement
) {
    // 创建depth texture
    const presentationSize = {
        width: canvas.clientWidth * devicePixelRatio,
        height: canvas.clientHeight * devicePixelRatio,
    };
    const depthTexture = device.createTexture({
        size: presentationSize,
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

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

    // 1.创建存储MVP矩阵数据和颜色属性值的Buffer
    const modelViewBuffer = device.createBuffer({
        label: "GPUBuffer sotre n*4x4 matrix",
        size: 4 * 4 * 4 * NUM, // 4 x 4 x float32 x NUM
        usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST
    });
    const projectionBuffer = device.createBuffer({
        label: "GPUBuffer sotre 4x4 matrix",
        size: 4 * 4 * 4, // 4 x 4 x float32
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });
    const colorBuffer = device.createBuffer({
        label: "GPUBuffer sotre n*4 color",
        size: 4 * 4 * NUM, // 4 x float32 x NUM
        usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST
    });

    // 2.创建uniformGroup
    const vsGroup = device.createBindGroup({
        label: "Uniform Group with matrix",
        layout: pipeline.getBindGroupLayout(0),
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
                    buffer: projectionBuffer
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: colorBuffer
                }
            }
        ]
    });

    // 1.创建存储环境光、点光源和平行光的buffer
    const ambientBuffer = device.createBuffer({
        label: "ambientBuffer store ambient intensity",
        size: 1 * 4,  // 1个float32
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });
    const pointLightBuffer = device.createBuffer({
        label: "pointLightBuffer store point light data",
        size: 8 * 4,  // 8个float32，其中前4个存储位置、后4个存储点光源属性值
        usage:
            GPUBufferUsage.UNIFORM |
            GPUBufferUsage.COPY_DST
    });
    // 2.创建Group
    const lightGroup = device.createBindGroup({
        label: "uniform group for light buffer",
        layout: pipeline.getBindGroupLayout(1),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: ambientBuffer
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: pointLightBuffer
                }
            }
        ]
    })

    return {depthTexture, boxBuffer, sphereBuffer, 
            modelViewBuffer, projectionBuffer, colorBuffer, vsGroup, 
            ambientBuffer, pointLightBuffer, lightGroup};
}

// 编写绘图指令，并传递给本地的GPU设备
function draw(
    device: GPUDevice,
    context: GPUCanvasContext,
    pipeline: GPURenderPipeline,
    resourcesObj: {
        depthTexture: GPUTexture
        boxBuffer: {vertex: GPUBuffer, index: GPUBuffer},
        sphereBuffer: {vertex: GPUBuffer, index: GPUBuffer},
        modelViewBuffer: GPUBuffer
        projectionBuffer: GPUBuffer
        colorBuffer: GPUBuffer
        vsGroup: GPUBindGroup
        ambientBuffer: GPUBuffer
        pointLightBuffer: GPUBuffer
        lightGroup: GPUBindGroup
    }
) {
    // 描述render pass
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
            view: resourcesObj.depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store",
        }
    };

    // 创建所有object的model matrix
    const scene: any[] = [];
    const modelViewMatrix = new Float32Array(NUM * 4 * 4);
    const colorBuffer = new Float32Array(NUM * 4);
    for (let i = 0; i < NUM; ++i) {
        // 创建简单的object
        const position = {x: Math.random() * 40 - 20, y: Math.random() * 40 - 20, z: -50 - Math.random() * 50};
        const rotation = {x: Math.random(), y: Math.random(), z: Math.random()};
        const scale = {x: 1, y: 1, z: 1};
        const modelView = getModelViewMatrix(position, rotation, scale);
        modelViewMatrix.set(modelView, i * 4 * 4);
        // 给每一个object设置随机颜色值
        colorBuffer.set([Math.random(), Math.random(), Math.random(), 1], i * 4);
        scene.push({position, rotation, scale});
    }

    // 初始化光源数据
    const ambient = new Float32Array([0.1]);
    const pointLight = new Float32Array(8);
    pointLight[2] = -50;   // z
    pointLight[4] = 1;     // intensity
    pointLight[5] = 40;    // radius

    // 每帧需更新的数据可以在该接口中实现更新
    function frame(){
        // 更新光源数据
        const now = performance.now();
        pointLight[0] = 10 * Math.sin(now / 1000);
        pointLight[1] = 10 * Math.cos(now / 1000);
        pointLight[2] = -60 + 10 * Math.cos(now / 1000);

        // 将光源数据写入到buffer中
        device.queue.writeBuffer(resourcesObj.ambientBuffer, 0, ambient);
        device.queue.writeBuffer(resourcesObj.pointLightBuffer, 0, pointLight);

        // 将第500个obj作为点光源位置显示
        const position = {x: pointLight[0], y: pointLight[1], z: pointLight[2]};
        const rotation = {x: 1.0, y: 1.0, z: 1.0};
        const scale = {x: 0.5, y: 0.5, z: 0.5};
        const modelView = getModelViewMatrix(position, rotation, scale);
        modelViewMatrix.set(modelView, (NUM - 1) * 4 * 4);
        colorBuffer.set([1.0, 1.0, 1.0, 1.0], (NUM - 1) * 4);
        // 将modelViewMatrix和color写入buffer中
        device.queue.writeBuffer(resourcesObj.colorBuffer, 0, colorBuffer);
        device.queue.writeBuffer(resourcesObj.modelViewBuffer, 0, modelViewMatrix);

        // 获取最新的canvas上下文纹理视图用于刷新帧内容
        renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, resourcesObj.vsGroup);
        // 设置光源group
        passEncoder.setBindGroup(1, resourcesObj.lightGroup);
        // 设置box vertex
        passEncoder.setVertexBuffer(0, resourcesObj.boxBuffer.vertex);
        passEncoder.setIndexBuffer(resourcesObj.boxBuffer.index, "uint16");
        passEncoder.drawIndexed(box.indexCount, NUM / 2, 0, 0, 0);
        // 设置sphere vertex
        passEncoder.setVertexBuffer(0, resourcesObj.sphereBuffer.vertex);
        passEncoder.setIndexBuffer(resourcesObj.sphereBuffer.index, "uint16");
        passEncoder.drawIndexed(sphere.indexCount, NUM / 2, 0, 0, NUM / 2);
        passEncoder.end();
        const gpuCommandBuffer = commandEncoder.finish();
        device.queue.submit([gpuCommandBuffer]);

        // 用于帧刷新（需递归调用）
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // UI
    document.querySelector('#ambientIntensity')?.addEventListener('input', (e:Event) => {
        ambient[0] = +(e.target as HTMLInputElement).value;
    })
    document.querySelector('#pointLightRadius')?.addEventListener('input', (e:Event) => {
        pointLight[5] = +(e.target as HTMLInputElement).value;
    })
}

async function run() {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("No Canvas");
    // init WebGPU
    const { device, context, format, presentationSize } = await initWebGPU(canvas);
    // render pipeline
    const pipeline = await initPipeline(device, format);
    // create all resources
    const resourcesObj = await createResources(device, pipeline, canvas);
    // draw call
    draw(device, context, pipeline, resourcesObj);

    // update camera
    function updateCamera(){
        const aspect = presentationSize.width / presentationSize.height;
        const projectionMatrix = getProjectionMatrix(aspect);
        device.queue.writeBuffer(resourcesObj.projectionBuffer, 0, projectionMatrix);
    }

    updateCamera();

    // resize window that need to update render
    window.addEventListener("resize", () => {
        canvas.width=canvas.clientWidth * devicePixelRatio
        canvas.height=canvas.clientHeight * devicePixelRatio
            context.configure({
                device,
                format,
                alphaMode: "opaque",
            });
            draw(device, context, pipeline, resourcesObj);
            updateCamera();
    })
}

run();
