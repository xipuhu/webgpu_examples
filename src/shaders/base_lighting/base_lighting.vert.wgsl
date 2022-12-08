@group(0) @binding(0) var<storage> modelViews : array<mat4x4<f32>>;
@group(0) @binding(1) var<uniform> projection : mat4x4<f32>;
@group(0) @binding(2) var<storage> colors : array<vec4<f32>>;

struct VertexOutput {
    @builtin(position) Position : vec4<f32>,
    @location(0) fragPosition : vec3<f32>,
    @location(1) fragNormal : vec3<f32>,
    @location(2) fragUV : vec2<f32>,
    @location(3) fragColor : vec4<f32>
}

@vertex
fn main(
    @builtin(instance_index) index : u32,
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>,
    @location(2) uv : vec2<f32>
) -> VertexOutput {
    let modelView = modelViews[index];
    let mvp = projection * modelView;
    let pos = vec4<f32>(position, 1.0);

    var output : VertexOutput;
    output.Position = mvp * pos;
    output.fragPosition = (modelView * pos).xyz;
    output.fragNormal = (modelView * vec4<f32>(normal, 0.0)).xyz;
    output.fragUV = uv;
    output.fragColor = colors[index];

    return output;
}
