import lightupdate from '../shaders/deferredRendering/lightUpdate.cmp.wgsl?raw';
import vertexWriteGBuffers from '../shaders/deferredRendering/writeGBuffers.vert.wgsl?raw';
import fragmentWriteGBuffers from '../shaders/deferredRendering/writeGBuffers.frag.wgsl?raw';
import vertexTextureQuad from '../shaders/deferredRendering/textureQuad.vert.wgsl?raw';
import fragmentGBuffersDebugView from '../shaders/deferredRendering/gBuffersDebugView.frag.wgsl?raw';
import fragmentDeferredRendering from '../shaders/deferredRendering/deferredRendering.frag.wgsl?raw';

import { mesh } from '../meshes/stanfordDragon';
import { mat4, vec3, vec4 } from 'gl-matrix';

import { GUI } from "dat.gui";
import Stats from 'stats.js'

// UI设置项
const settings = {
    mode: 'rendering',
    numLights: 32
};

// 性能统计面板
const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

/* 
1、绘制stanfordDragon模型
2、创建三个pipelien: writeGBuffersPipeline、gBuffersDebugViewPipeline和deferredRenderPipeline
3、创建三个texture buffer（position、normal和albedo）
4、创建三个pass：gBufferPass、lightPass和deferredRenderingPass
5、不同的pipeline之间数据交流是通过绑定在pipeline上面的BindGroupLayout来完成的
*/

// light属性
const kMaxNumLights = 1024;
const lightExtentMin = vec3.fromValues(-50, -30, -50);
const lightExtentMax = vec3.fromValues(50, 50, 50);

// GUI组件初始化
const gui = new GUI();

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
    canvas.width  = presentationSize.width;
    canvas.height = presentationSize.height;
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
    format: GPUTextureFormat,
    canvas: HTMLCanvasElement
) {
    // vertex buffer
    const vertexBuffers: Iterable<GPUVertexBufferLayout> = [{
        arrayStride: Float32Array.BYTES_PER_ELEMENT * 8,
        attributes: [
            {
                // position
                shaderLocation: 0,
                offset: 0,
                format: 'float32x3'
            },
            {
                // normal
                shaderLocation: 1,
                offset: Float32Array.BYTES_PER_ELEMENT * 3,
                format: 'float32x3'
            },
            {
                // uv
                shaderLocation: 2,
                offset: Float32Array.BYTES_PER_ELEMENT * 6,
                format: 'float32x2'
            }
        ]
    }]
    // primitive
    const primitive: GPUPrimitiveState = {
        topology: 'triangle-list',
        cullMode: 'back'
    };

    // writeGBuffersPipeline
    const writeGBuffersPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: device.createShaderModule({
                code: vertexWriteGBuffers,
            }),
            entryPoint: 'main',
            buffers: vertexBuffers
        },
        fragment: {
            module: device.createShaderModule({
                code: fragmentWriteGBuffers,
            }),
            entryPoint: 'main',
            targets: [
                {format: 'rgba16float'},  // normal
                {format: 'bgra8unorm'}    // albedo
            ]
        },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus'
        },
        primitive
    });

    // gBuffersDebugViewPipeline and deferredRenderPipeline
    // 1. gBufferTextureBindGroupLayout
    const gBufferTextureBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'unfilterable-float',
                }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'unfilterable-float',
                }
            },
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT,
                texture: {
                    sampleType: 'depth',
                }
            }
        ]
    });
    // 2. lightsBufferBindGroupLayout
    const lightsBufferBindGroupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'read-only-storage'
                }
            },
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'uniform',
                }
            },
            {
                binding: 2,
                visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                buffer: {
                    type: 'uniform',
                }
            }
        ]
    });

    // 3. gBuffersDebugViewPipeline
    const gBuffersDebugViewPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [gBufferTextureBindGroupLayout],
        }),
        vertex: {
            module: device.createShaderModule({
                code: vertexTextureQuad
            }),
            entryPoint: 'main',
        },
        fragment: {
            module: device.createShaderModule({
                code: fragmentGBuffersDebugView,
            }),
            entryPoint: 'main',
            targets: [
                {
                    format,
                }
            ],
            constants: {
                canvasSizeWidth: canvas.width,
                canvasSizeHeight: canvas.height,
            }
        },
        primitive
    });
    // 4. deferredRenderPipeline
    const deferredRenderingPipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({
            bindGroupLayouts: [
                gBufferTextureBindGroupLayout,    // @group(0)
                lightsBufferBindGroupLayout,      // @group(1)
            ]
        }),
        vertex: {
            module: device.createShaderModule({
                code: vertexTextureQuad,
            }),
            entryPoint: 'main'
        },
        fragment: {
            module: device.createShaderModule({
                code: fragmentDeferredRendering
            }),
            entryPoint: 'main',
            targets: [
                {
                    format,
                }
            ]
        },
        primitive
    });
    // 5. lightUpdateComputePipeline
    const lightUpdateComputePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: {
            module: device.createShaderModule({
                code: lightupdate
            }),
            entryPoint: 'main'
        }
    })

    return {writeGBuffersPipeline, gBuffersDebugViewPipeline, deferredRenderingPipeline, lightUpdateComputePipeline};
}

// 创建所需的vertexBuffer、indexBuffer、uniformBuffer和bindGroup
async function createResources(
    device: GPUDevice,
    pipelineObj: {
        writeGBuffersPipeline: GPURenderPipeline,
        gBuffersDebugViewPipeline: GPURenderPipeline,
        deferredRenderingPipeline: GPURenderPipeline,
        lightUpdateComputePipeline: GPUComputePipeline
    },
    canvas: HTMLCanvasElement
) {
    // 创建depth texture
    const presentationSize = [
        canvas.clientWidth * devicePixelRatio, 
        canvas.clientHeight * devicePixelRatio
    ];
    const depthTexture = device.createTexture({
        size: presentationSize,
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });

    // 1、创建model的vertexBuffer和indexBuffer
    const kVertexStride = 8;
    // vertexBuffer
    const dragonVertexBuffer = device.createBuffer({
        // position: vec3, normal: vec3, uv: vec2
        size: mesh.positions.length * kVertexStride * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true
    });
    {
        const mapping = new Float32Array(dragonVertexBuffer.getMappedRange());
        for (let i = 0; i < mesh.positions.length; ++i) {
            mapping.set(mesh.positions[i], kVertexStride * i);
            mapping.set(mesh.normals[i], kVertexStride * i + 3);
            mapping.set(mesh.uvs[i], kVertexStride * i + 6);
        }
        dragonVertexBuffer.unmap();
    }
    // indexBuffer
    const indexCount = mesh.triangles.length * 3;
    const dragonIndexBuffer = device.createBuffer({
        size: indexCount * Uint16Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true
    });
    {
        const mapping = new Uint16Array(dragonIndexBuffer.getMappedRange());
        for (let i = 0; i < mesh.triangles.length; ++i) {
            mapping.set(mesh.triangles[i], 3 * i);
        }
        dragonIndexBuffer.unmap();
    }

    // 2、创建GBuffer texture render targets和gBufferTextureBindGroup
    const gBufferTexture2DFloat16 = device.createTexture({
        size: [...presentationSize, 2],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        format: 'rgba16float'
    });
    const gBufferTextureAlbedo = device.createTexture({
        size: presentationSize,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        format: 'bgra8unorm'
    })
    const gBufferTextureViews = [
        gBufferTexture2DFloat16.createView({
            dimension: '2d',
            baseArrayLayer: 0,
            arrayLayerCount: 1
        }),
        gBufferTextureAlbedo.createView(),
        depthTexture.createView()
    ];
    const gBufferTexturesBindGroup = device.createBindGroup({
        layout: pipelineObj.gBuffersDebugViewPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: gBufferTextureViews[0]
            },
            {
                binding: 1,
                resource: gBufferTextureViews[1]
            },
            {
                binding: 2,
                resource: gBufferTextureViews[2]
            }
        ]
    })

    // 3、创建场景相关的UniformBindGroup
    const modelUniformBuffer = device.createBuffer({
        size: 4 * 16 * 2, // two 4x4 matrix
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const cameraUniformBuffer = device.createBuffer({
        size: 4 * 16 * 2, // 4x4 matrix
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const sceneUniformBindGroup = device.createBindGroup({
        layout: pipelineObj.writeGBuffersPipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: modelUniformBuffer
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: cameraUniformBuffer
                }
            }
        ]
    });

    // 4、创建lightsBufferBindGroup和lightsBufferComputeBindGroup
    const lightDataStride = 8;
    const bufferSizeInByte = Float32Array.BYTES_PER_ELEMENT * lightDataStride * kMaxNumLights;
    const lightsBuffer = device.createBuffer({
        size: bufferSizeInByte,
        usage: GPUBufferUsage.STORAGE,
        mappedAtCreation: true
    });
    
    const configUniformBuffer = (() => {
        const buffer = device.createBuffer({
            size: Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Uint32Array(buffer.getMappedRange())[0] = settings.numLights;
        buffer.unmap();
        return buffer;
    })();
    // 绘制ui用于控制settings
    gui.add(settings, 'mode', ['rendering', 'gBuffers view']);
    gui.add(settings, 'numLights', 1, kMaxNumLights)
        .step(1)
        .onChange(() => {
            device.queue.writeBuffer(
                configUniformBuffer,
                0,
                new Uint32Array([settings.numLights])
            );
        });

    const lightExtentBuffer = device.createBuffer({
        size: 4 * 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    })
    const lightsBufferBindGroup = device.createBindGroup({
        layout: pipelineObj.deferredRenderingPipeline.getBindGroupLayout(1),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: lightsBuffer,
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: configUniformBuffer
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: cameraUniformBuffer,
                }
            }
        ]
    });
    const lightsBufferComputeBindGroup = device.createBindGroup({
        layout: pipelineObj.lightUpdateComputePipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: lightsBuffer,
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: configUniformBuffer
                }
            },
            {
                binding: 2,
                resource: {
                    buffer: lightExtentBuffer
                }
            }
        ]
    });

    // 将初始光源数据写入lightsBuffer（storage buffer）中
    const extent = vec3.create();
    vec3.sub(extent, lightExtentMax, lightExtentMin);
    const lightData = new Float32Array(lightsBuffer.getMappedRange());
    const tmpVec4 = vec4.create();

    let offset = 0;
    for (let i = 0; i < kMaxNumLights; ++i) {
        offset = lightDataStride * i;
        // position
        for (let i = 0; i < 3; ++i) {
            tmpVec4[i] = Math.random() * extent[i] + lightExtentMin[i];
        }
        tmpVec4[3] = 1;
        lightData.set(tmpVec4, offset);
        // color
        tmpVec4[0] = Math.random() * 2;
        tmpVec4[1] = Math.random() * 2;
        tmpVec4[2] = Math.random() * 2;
        // radius
        tmpVec4[3] = 20.0;
        lightData.set(tmpVec4, offset + 4);
    }
    lightsBuffer.unmap();

    return {depthTexture, dragonVertexBuffer, dragonIndexBuffer,
            gBufferTexture2DFloat16, gBufferTextureAlbedo, gBufferTextureViews, gBufferTexturesBindGroup,
            modelUniformBuffer, cameraUniformBuffer, sceneUniformBindGroup,
            lightsBuffer, configUniformBuffer, lightExtentBuffer, lightsBufferBindGroup, lightsBufferComputeBindGroup};
}

// 编写绘图指令，并传递给本地的GPU设备
function draw(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvas: HTMLCanvasElement,
    pipelineObj: {
        writeGBuffersPipeline: GPURenderPipeline,
        gBuffersDebugViewPipeline: GPURenderPipeline,
        deferredRenderingPipeline: GPURenderPipeline,
        lightUpdateComputePipeline: GPUComputePipeline
    },
    resourcesObj: {
        depthTexture: GPUTexture,
        dragonVertexBuffer: GPUBuffer,
        dragonIndexBuffer: GPUBuffer,
        lightExtentBuffer: GPUBuffer,
        cameraUniformBuffer: GPUBuffer,
        modelUniformBuffer: GPUBuffer,
        gBufferTextureViews: GPUTextureView [],
        sceneUniformBindGroup: GPUBindGroup,
        lightsBufferBindGroup: GPUBindGroup,
        lightsBufferComputeBindGroup: GPUBindGroup,
        gBufferTexturesBindGroup: GPUBindGroup
    }
) {
    // 1、写入lightExtentData数据
    const lightExtentData = new Float32Array(8);
    lightExtentData.set(lightExtentMin, 0);
    lightExtentData.set(lightExtentMax, 4);
    device.queue.writeBuffer(
        resourcesObj.lightExtentBuffer,
        0,
        lightExtentData.buffer,
        lightExtentData.byteOffset,
        lightExtentData.byteLength
    );

    // 2、获取显示分辨率
    const presentationSize = [
        canvas.clientWidth * devicePixelRatio, 
        canvas.clientHeight * devicePixelRatio
    ];

    // 3、设置mvp矩阵用于设置camera
    const eyePosition = vec3.fromValues(0, 50, -100);
    const upVector = vec3.fromValues(0, 1, 0);
    const origin = vec3.fromValues(0, 0, 0);
    const projectionMatrix = mat4.create();
    const aspect = presentationSize[0] / presentationSize[1];
    mat4.perspective(
        projectionMatrix,
        (2 * Math.PI) / 5,
        aspect,
        1,
        2000.0
    );

    const viewMatrix = mat4.create();
    mat4.lookAt(viewMatrix, eyePosition, origin, upVector);
    const viewProjMatrix = mat4.create();
    mat4.multiply(viewProjMatrix, projectionMatrix, viewMatrix);
    const modelMatrix = mat4.create();
    mat4.translate(modelMatrix, modelMatrix, vec3.fromValues(0, -45, 0));

    // 4、将数据写入到modelUniformBuffer中
    const modelData = modelMatrix as Float32Array;
    device.queue.writeBuffer(
        resourcesObj.modelUniformBuffer,
        0,
        modelData.buffer,
        modelData.byteOffset,
        modelData.byteLength
    )
    const invertTransposeModelMatrix = mat4.create();
    mat4.transpose(invertTransposeModelMatrix, invertTransposeModelMatrix);
    const normalModelData = invertTransposeModelMatrix as Float32Array;
    device.queue.writeBuffer(
        resourcesObj.modelUniformBuffer,
        64,
        normalModelData.buffer,
        normalModelData.byteOffset,
        normalModelData.byteLength
    )

    // 5、计算每一次需要旋转camera的数据
    function getCameraViewProjMatrix() {
        const eyePosition = vec3.fromValues(0, 50, -200);

        const rad = Math.PI * (Date.now() / 5000);
        vec3.rotateY(eyePosition, eyePosition, origin, rad);

        const viewMatrix = mat4.create();
        mat4.lookAt(viewMatrix, eyePosition, origin, upVector);
        mat4.multiply(viewProjMatrix, projectionMatrix, viewMatrix);

        return viewProjMatrix as Float32Array;
    }

    // 6、定义writeGBufferPassDescriptor和textureQuadPassDescriptor
    const writeGBufferPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
            {
                view: resourcesObj.gBufferTextureViews[0],
                clearValue: {r: 0.0, g: 0.0, b: 1.0, a: 1.0},
                loadOp: 'clear',
                storeOp: 'store'
            },
            {
                view: resourcesObj.gBufferTextureViews[1],
                clearValue: {r: 0.0, g: 0.0, b: 0.0, a: 1.0},
                loadOp: 'clear',
                storeOp: 'store'
            }
        ],
        depthStencilAttachment: {
            view: resourcesObj.depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store'
        }
    };
    const textureQuadPassDescriptor: GPURenderPassDescriptor = {
        colorAttachments: [
            {
                view: context.getCurrentTexture().createView(),
                clearValue: {r: 0.2, g: 0.3, b: 0.3, a: 1.0},
                loadOp: 'clear',
                storeOp: 'store'
            },
        ]
    };

    // 每帧需更新的数据可以在该接口中实现更新
    function frame(){
        stats.begin();
        // 1、更新mvp矩阵
        const cameraViewProj = getCameraViewProjMatrix();
        device.queue.writeBuffer(
            resourcesObj.cameraUniformBuffer,
            0,
            cameraViewProj.buffer,
            cameraViewProj.byteOffset,
            cameraViewProj.byteLength
        )

        // 2、获取cameraViewProj的逆矩阵（用于将像素屏幕坐标转换成世界坐标）
        const cameraInvViewProj = mat4.create();
        mat4.invert(cameraInvViewProj, cameraViewProj);
       const cameraInvViewProj2 = cameraInvViewProj as Float32Array;

        device.queue.writeBuffer(
            resourcesObj.cameraUniformBuffer,
            64,
            cameraInvViewProj2.buffer,
            cameraInvViewProj2.byteOffset,
            cameraInvViewProj2.byteLength
        )

        // 3、将gBufferPass、lightPass和deferredRenderingPass绑定到commandEncoder上
        const commandEncoder = device.createCommandEncoder();
        // gBufferPass
        {
            // write position, normal, albedo etc data to gBuffers
            const gBufferPass = commandEncoder.beginRenderPass(writeGBufferPassDescriptor);
            gBufferPass.setPipeline(pipelineObj.writeGBuffersPipeline);
            gBufferPass.setBindGroup(0, resourcesObj.sceneUniformBindGroup);
            gBufferPass.setVertexBuffer(0, resourcesObj.dragonVertexBuffer);
            gBufferPass.setIndexBuffer(resourcesObj.dragonIndexBuffer, 'uint16');
            gBufferPass.drawIndexed(mesh.triangles.length * 3);
            gBufferPass.end();
        }
        // lightPass: update lights position
        {
            const lightPass = commandEncoder.beginComputePass();  // computePass不需要descriptor
            lightPass.setPipeline(pipelineObj.lightUpdateComputePipeline);
            lightPass.setBindGroup(0, resourcesObj.lightsBufferComputeBindGroup);
            lightPass.dispatchWorkgroups(Math.ceil(kMaxNumLights / 64));
            lightPass.end();
        }

        textureQuadPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
        if (settings.mode === 'gBuffers view') {
            // GBuffers debug view
            // Left: position
            // Middle: normal
            // Right: albedo (use uv to mimic a checkerboard texture)
            const debugViewPass = commandEncoder.beginRenderPass(textureQuadPassDescriptor);
            debugViewPass.setPipeline(pipelineObj.gBuffersDebugViewPipeline);
            debugViewPass.setBindGroup(0, resourcesObj.gBufferTexturesBindGroup);
            debugViewPass.draw(6);
            debugViewPass.end();
        } else {
            // deferred rendering pass
            const deferredRenderingPass = commandEncoder.beginRenderPass(textureQuadPassDescriptor);
            deferredRenderingPass.setPipeline(pipelineObj.deferredRenderingPipeline);
            deferredRenderingPass.setBindGroup(0, resourcesObj.gBufferTexturesBindGroup);
            deferredRenderingPass.setBindGroup(1, resourcesObj.lightsBufferBindGroup);
            deferredRenderingPass.draw(6);
            deferredRenderingPass.end();
        }
        // 4、提交gpuCommandBuffer
        const gpuCommandBuffer = commandEncoder.finish();
        device.queue.submit([gpuCommandBuffer]);

        stats.end();

        // 用于帧刷新（需递归调用）
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

async function run() {
    const canvas = document.querySelector("canvas");
    if (!canvas) throw new Error("No Canvas");

    // init WebGPU
    const { device, context, format } = await initWebGPU(canvas);
    // render pipeline
    const pipelineObj = await initPipeline(device, format, canvas);
    // create all resources
    const resourcesObj = await createResources(device, pipelineObj, canvas);
    // draw call
    draw(device, context, canvas, pipelineObj, resourcesObj);

    // resize window that need to update render
    window.addEventListener("resize", () => {
        canvas.width=canvas.clientWidth * devicePixelRatio
        canvas.height=canvas.clientHeight * devicePixelRatio
            context.configure({
                device,
                format,
                alphaMode: "opaque",
            });
            draw(device, context, canvas, pipelineObj, resourcesObj);
    })
}

run();
