import cubeVert from "../shaders/two_cubes/cube.vert.wgsl?raw"
import cubFrag from "../shaders/two_cubes/cube.frag.wgsl?raw"

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
// 编写绘图指令，并传递给本地的GPU设备
function draw(
    device: GPUDevice,
    context: GPUCanvasContext,
    pipeline: GPURenderPipeline,
    canvas: HTMLCanvasElement
) {
    //  创建cube vertex buffer
    const cubeVerticesBuffer = device.createBuffer({
        size: cubeVertexArray.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    new Float32Array(cubeVerticesBuffer.getMappedRange()).set(cubeVertexArray);
    cubeVerticesBuffer.unmap();

    //  创建depth texture
    const presentationSize = {
        width: canvas.clientWidth * devicePixelRatio,
        height: canvas.clientHeight * devicePixelRatio,
    };
    const depthTexture = device.createTexture({
        size: presentationSize,
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    
    // todo 将两个变换矩阵保存在一个uniform buffer中（两个cube共用一个uniform buffer）
    const matrixSize = 4 * 16;  // 4x4 matrix
    const offset = 256; // uniformBindGroup offset must be 256-byte aligned
    const uniformBufferSize = offset + matrixSize;
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    //  为uniformBuffer创建BindGroup
    const uniformBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: uniformBuffer,
                    offset: 0,
                    size: matrixSize
                }
            }
        ]
    });

    // todo 创建第二个BindGroup用来传递变换矩阵
    const uniformBindGroup2 = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: uniformBuffer,
                    offset: offset,
                    size: matrixSize
                }
            }
        ]
    });

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
            view: depthTexture.createView(),
            
            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store",
        }
    };

    //  创建投影矩阵
    const aspect = canvas.width / canvas.height;
    const projectionMatrix = mat4.create();
    mat4.perspective(projectionMatrix, (2 * Math.PI) / 5, aspect, 1, 1000.0);

    //  获取获取MVP矩阵数据
    function getTransformationMatrix() {
        const viewMatrix = mat4.create();
        mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(2, 0, -10));
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

    // todo 获取第二个cube的mvp矩阵
    function getTransformationMatrix2() {
        const viewMatrix = mat4.create();
        mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(-2, 0, -10));
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

    function frame(){
        //  将旋转矩阵数据写入uniform buffer中
        const transformationMatrix = getTransformationMatrix();
        device.queue.writeBuffer(
            uniformBuffer,
            0,
            transformationMatrix.buffer,
            transformationMatrix.byteOffset,
            transformationMatrix.byteLength,
        );

        // todo 将第二个cube的mvp矩阵数据写入buffer
        const transformationMatrix2 = getTransformationMatrix2();
        device.queue.writeBuffer(
            uniformBuffer,
            offset,
            transformationMatrix2.buffer,
            transformationMatrix2.byteOffset,
            transformationMatrix2.byteLength,
        );

        //  获取最新的canvas上下文纹理视图用于刷新帧内容
        renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(pipeline);
        passEncoder.setVertexBuffer(0, cubeVerticesBuffer);

        passEncoder.setBindGroup(0, uniformBindGroup);
        passEncoder.draw(cubeVertexCount, 1, 0, 0);

        // todo 绘制第二个cube
        passEncoder.setBindGroup(0, uniformBindGroup2);
        passEncoder.draw(cubeVertexCount, 1, 0, 0);

        passEncoder.end();
        const gpuCommandBuffer = commandEncoder.finish();
        device.queue.submit([gpuCommandBuffer]);

        //  用于帧刷新（需递归调用）
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

async function run() {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("No Canvas");
    // init WebGPU
    const { device, context, format} = await initWebGPU(canvas);
    // render pipeline
    const pipeline = await initPipeline(device, format);
    // draw call
    draw(device, context, pipeline, canvas);
    // resize window that need to update render
    window.addEventListener("resize", () => {
    canvas.width=canvas.clientWidth * devicePixelRatio
    canvas.height=canvas.clientHeight * devicePixelRatio
        context.configure({
            device,
            format,
            alphaMode: "opaque",
        });
        draw(device, context, pipeline, canvas);
    })
}

run();
