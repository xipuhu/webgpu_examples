import cubeVert from "../shaders/cube_spriteTexture/cube.vert.wgsl?raw"
import cubFrag from "../shaders/cube_spriteTexture/cube_spriteTexture.frag.wgsl?raw"
import imageUrl from "../images/sprites.webp?url"

import {
    cubeVertexArray,
    cubeVertexSize,
    cubeUVOffset,
    cubePositionOffset,
    cubeVertexCount} from "../meshes/cube"

import {mat4, vec3} from "gl-matrix"

// 初始化WebGPU
async function initWebGPU(canvas: HTMLCanvasElement) {
    // 判断当前设备是否支持WebGPU
    if (!navigator.gpu) throw new Error("Not Support WebGPU");
    // 请求Adapter对象，GPU在浏览器中的抽象代理
    const adapter = await navigator.gpu.requestAdapter({
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
                code: cubeVert,
            }),
            entryPoint: "main",
            buffers: [
                {
                    arrayStride: cubeVertexSize,
                    attributes: [
                        {
                            // position
                            shaderLocation: 0,
                            offset: cubePositionOffset,
                            format: 'float32x4',
                        },
                        {
                            // uv
                            shaderLocation: 1,
                            offset: cubeUVOffset,
                            format: 'float32x2',
                        }
                    ]
                }
            ]
        },
        // 片元着色器
        fragment: {
            module: device.createShaderModule({
                code: cubFrag,
            }),
            entryPoint: "main",
            targets: [
                {
                    // 颜色格式
                    format: format,
                },
            ],
        },
        primitive: {
            topology: "triangle-list",
            //  开启背面剔除
            cullMode: "back",
        },
        //  使能深度测试
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: "less",
            format: "depth24plus",
        },
        // 渲染管线的布局
        layout: "auto",
    };

    // 返回异步管线
    return await device.createRenderPipelineAsync(descriptor);
}

// 创建所需的vertexBuffer、uniformBuffer和bindGroup
async function createResources(
    device: GPUDevice,
    pipeline: GPURenderPipeline,
    canvas: HTMLCanvasElement
) {
    // 创建cube vertex buffer
    const verticesBuffer = device.createBuffer({
        size: cubeVertexArray.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(verticesBuffer.getMappedRange()).set(cubeVertexArray);
    verticesBuffer.unmap();

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

    // 创建uniform buffer
    const uniformBufferSize = 4 * 16;  // 4x4 matrix
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // 为uniformBuffer创建BindGroup
    const uniformGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: uniformBuffer,
                }
            }
        ]
    });

    // 1.从host中获取纹理资源并创建devcie纹理buffer
    const res = await fetch(imageUrl);
    const img = await res.blob();
    const bitmap = await createImageBitmap(img);
    const textureSize = [bitmap.width, bitmap.height];
    const texture = device.createTexture({
        size: textureSize,
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture(
        {source: bitmap},
        {texture: texture},
        textureSize
    );
    // 2.创建一个Sampler
    const sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear'
    });

    // todo 创建一个uvOffset buffer用来控制纹理显示的区域
    const uvOffset = new Float32Array([0, 0, 1/3, 1/2]);
    const uvBuffer = device.createBuffer({
        label: 'GPUBuffer store UV offset',
        size: 4* 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(uvBuffer, 0, uvOffset);

    // 3.将创建好的sampler和GPUTexture打包进bindGroup
    const textureGroup = device.createBindGroup({
        label: 'Texture Group with Texture & Sampler',
        layout: pipeline.getBindGroupLayout(1),
        entries: [
            {
                binding: 0,
                resource: sampler
            },
            {
                binding: 1,
                resource: texture.createView()
            },
            // todo 将uvOffset Buffer绑定到bindGroup上
            {
                binding: 2,
                resource: {
                    buffer: uvBuffer
                }
            }
        ]
    })

    return {verticesBuffer, depthTexture, uniformBuffer, uniformGroup, textureGroup, uvBuffer, uvOffset};
}

// 编写绘图指令，并传递给本地的GPU设备
async function draw(
    device: GPUDevice,
    context: GPUCanvasContext,
    pipeline: GPURenderPipeline,
    canvas: HTMLCanvasElement,
    resourcesObj: {
        verticesBuffer: GPUBuffer
        depthTexture: GPUTexture
        uniformBuffer: GPUBuffer
        uniformGroup: GPUBindGroup
        textureGroup: GPUBindGroup
        uvBuffer: GPUBuffer
        uvOffset: Float32Array
    }
) {
    const renderPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
            {
                view: context.getCurrentTexture().createView(),
                loadOp: "clear", // clear/load
                clearValue: { r: 0.2, g: 0.3, b: 0.3, a: 1.0 },
                storeOp: "store", // store/discard
            },
        ],
        //  depthStencil attachment
        depthStencilAttachment: {
            view: resourcesObj.depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store",
        }
    };

    // 创建投影矩阵
    const aspect = canvas.width / canvas.height;
    const projectionMatrix = mat4.create();
    mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 1, 1000.0);

    // 获取获取MVP矩阵数据
    function getTransformationMatrix() {
        const viewMatrix = mat4.create();
        mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(0, 0, -6));
        const now = Date.now() / 1000;
        mat4.rotate(
            viewMatrix,
            viewMatrix,
            1,
            vec3.fromValues(Math.sin(now), Math.cos(now), 0)
        );
        const modelViewProjectionMatrix = mat4.create();
        mat4.multiply(modelViewProjectionMatrix, projectionMatrix, viewMatrix);
        return modelViewProjectionMatrix as Float32Array;
    }

    let count = 0;
    function frame(){
        // todo 每一帧都控制sprite的uvOffset值
        ++count;
        if (count % 30 === 0) {
            let tmp = resourcesObj.uvOffset[0];
            resourcesObj.uvOffset[0] = tmp >= 2/3 ? 0 : tmp + 1/3;
            if (count % 90 === 0) {
                tmp = resourcesObj.uvOffset[1];
                resourcesObj.uvOffset[1] = tmp >= 1/2 ? 0 : tmp + 1/2;
            }
            device.queue.writeBuffer(resourcesObj.uvBuffer, 0, resourcesObj.uvOffset);
        }

        //  将旋转矩阵数据写入uniform buffer中
        const transformationMatrix = getTransformationMatrix();
        device.queue.writeBuffer(
            resourcesObj.uniformBuffer,
            0,
            transformationMatrix.buffer,
            transformationMatrix.byteOffset,
            transformationMatrix.byteLength,
        );

        //  获取最新的canvas上下文纹理视图用于刷新帧内容
        renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, resourcesObj.uniformGroup);
        passEncoder.setBindGroup(1, resourcesObj.textureGroup);
        passEncoder.setVertexBuffer(0, resourcesObj.verticesBuffer);
        passEncoder.draw(cubeVertexCount, 1, 0, 0);
        passEncoder.end();
        const gpuCommandBuffer = commandEncoder.finish();
        device.queue.submit([gpuCommandBuffer]);

        //  用于帧刷新（需递归调用）
        requestAnimationFrame(frame);
    }
    frame();
}

// 执行入口函数
async function run() {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("No Canvas");
    // init WebGPU
    const { device, context, format} = await initWebGPU(canvas);
    // render pipeline
    const pipeline = await initPipeline(device, format);
    // create all resources
    const resourcesObj = await createResources(device, pipeline, canvas);
    // draw call
    draw(device, context, pipeline, canvas, resourcesObj);
    // resize window that need to update render
    window.addEventListener("resize", () => {
    canvas.width=canvas.clientWidth * devicePixelRatio
    canvas.height=canvas.clientHeight * devicePixelRatio
        context.configure({
            device,
            format,
            alphaMode: "opaque",
        });
        draw(device, context, pipeline, canvas, resourcesObj);
    })
}

run();
