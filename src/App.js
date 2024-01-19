import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useThree, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';

// function CubeMapScene({ faces }) {
//     console.log(faces)
//     const texture = useLoader(THREE.CubeTextureLoader, faces);
//     useThree().scene.background = texture;

//     return (
//         <>
//             <PerspectiveCamera makeDefault position={[0, 0, 1]} />
//             <OrbitControls />
//             <mesh>
//                 <boxGeometry args={[1, 1, 1]} />
//                 <meshBasicMaterial envMap={texture} />
//             </mesh>
//         </>
//     );
// }

// function CubeMapPlayer({ faces, onClose }) {
//     return (
//         <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0, 0, 0, 0.9)' }}>
//             <button onClick={onClose} style={{ position: 'absolute', right: 10, top: 10, zIndex: 100 }}>Close</button>
//             <Canvas>
//                 <CubeMapScene faces={faces} />
//             </Canvas>
//         </div>
//     );
// }


function convertColorToBase64([r, g, b]) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 1, 1);
    return canvas.toDataURL();
}

function extractCubeFace(renderer, renderTarget, faceIndex, width, height, quality) {
    const pixels = new Uint8Array(width * height * 4);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels, faceIndex);
    
    const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
    context.putImageData(imageData, 0, 0);

    // Flip the image horizontally
    context.save();
    context.scale(-1, 1);
    context.drawImage(canvas, -width, 0, width, height);
    context.restore();

    // Rotate the 4th face (cube face 3) by 90 degrees
    if (faceIndex === 3) {
        context.save();
        context.translate(width / 2, height / 2);
        context.rotate(-Math.PI / 2);  // Rotate by 90 degrees
        context.drawImage(canvas, -width / 2, -height / 2, width, height);
        context.restore();
    }

    return canvas.toDataURL('image/jpeg', quality);
}

function applyWatermark(dataURL, text, quality, imageSrc, faceIndex) {  
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const image = new Image();
    const logo = new Image();

    let logoLoaded = false;

    logo.src = "logo/skynav_logo.svg";

    logo.onload = function() {
        console.log("Logo loaded successfully");
        logoLoaded = true;
    };

    logo.onerror = function(e) {
        console.error("Error loading the logo", e);
    };

    image.src = dataURL;

    return new Promise((resolve) => {
        image.onload = async () => {
            canvas.width = image.width;
            canvas.height = image.height;
            context.drawImage(image, 0, 0);

            // Top watermark
            const fontSize = Math.round(canvas.width / 10); 
            context.font = `${fontSize}px Arial`;
            context.fillStyle = 'rgba(255, 255, 255, 0.75)';
            context.shadowColor = 'rgba(0, 0, 0, 0.5)';
            context.shadowBlur = 7;
            context.shadowOffsetX = 3;
            context.shadowOffsetY = 3;

            const textWidth = context.measureText(text).width;
            const x = (canvas.width - textWidth) / 2;
            const y = canvas.height / 2;

            if (faceIndex !== 3) {
            context.fillText(text, x, y);
        }


            // Bottom watermark
            const bottomTextSize = Math.round(canvas.width / 40);
            context.font = `${bottomTextSize}px Arial`;

            const fetchedImage = await fetch(imageSrc);
            const imageSizeInBytes = (await fetchedImage.blob()).size;
            const imageSizeInKB = (imageSizeInBytes / 1024).toFixed(2);

            const bottomText = `${image.width}x${image.height} | ${imageSizeInKB}KB | Quality: ${Math.round(quality * 100)}% | Type: jpeg`;
            
            const bottomTextWidth = context.measureText(bottomText).width;
            const bx = (canvas.width - bottomTextWidth) / 2;
            const by = canvas.height - 5;
            context.fillText(bottomText, bx, by);

            // Add logo for face index 3
            
            if (faceIndex === 3 && logoLoaded) {
                const logoWidth = canvas.width / 4;
                const logoHeight = canvas.height / 4;
                
                const logoX = (canvas.width / 2) - (logoWidth / 2);
                const logoY = (canvas.height / 2) - (logoHeight / 2);
            
                context.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
            }
            

            resolve(canvas.toDataURL('image/jpeg', quality));
        };
    });
}



async function uploadFaceToServer(faceDataURL, faceIndex, setHtmlLink) {
    

    const formData = new FormData();
    
    // Convert DataURL to Blob
    const responseToBlob = await fetch(faceDataURL);
    const blob = await responseToBlob.blob();
    
    formData.append('image', blob, `face_${faceIndex}.jpeg`); 
    formData.append('faceIndex', faceIndex);
    
    console.log(formData)

    const API_URL = process.env.REACT_APP_API_URL;
    console.log(API_URL)

    const isLocalhost = window.location.hostname === "localhost";
    const endpoint = isLocalhost ? 'http://localhost:5001/upload' : 'https://imgproc-server.skynav.app/upload';

    const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
    });

    const result = await response.json();
    console.log(result)

    // if (result.htmlLink) {
    //     setHtmlLink(result.htmlLink);
    // }

    return result.tiles;

   
}

function Cubemap({ setCubeFaces, imageSrc, watermarkText, quality, cubeSize, shouldProcess }) {
    const { gl } = useThree();
    const processing = useRef(false);

    useEffect(() => {
        if (!imageSrc || !shouldProcess || processing.current) return;
    
        processing.current = true;
        const loader = new THREE.TextureLoader();
    
        loader.load(imageSrc, async (texture) => {
            const tempScene = new THREE.Scene();
            
            const geometry = new THREE.SphereGeometry(500, 60, 40);
            geometry.scale(-1, 1, 1);
            
            const material = new THREE.MeshBasicMaterial({ map: texture });
            tempScene.add(new THREE.Mesh(geometry, material));
            
            const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(cubeSize, {
                format: THREE.RGBAFormat,
                generateMipmaps: false,
                minFilter: THREE.LinearMipmapLinearFilter,
                anisotropy: 16
            });
            const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRenderTarget);
            cubeCamera.update(gl, tempScene);
    
            for (let i = 0; i < 6; i++) {
                let faceDataUrl = extractCubeFace(gl, cubeCamera.renderTarget, i, cubeSize, cubeSize, quality);
                
                if (watermarkText) {
                    faceDataUrl = await applyWatermark(faceDataUrl, watermarkText, quality, imageSrc, i);
                }
            
                // Update the state for this specific face.
                setCubeFaces(prevFaces => {
                    const newFaces = [...prevFaces];
                    newFaces[i] = faceDataUrl;
                    return newFaces;
                });
            
                // If you still want to upload the watermarked faces to the server, you can keep this line.
                await uploadFaceToServer(faceDataUrl, i);
            }
    
            processing.current = false;
        });
    }, [imageSrc, watermarkText, quality, cubeSize, shouldProcess]);
    

    return null;
}








function App() {
    const initialFaces = Array(6).fill(convertColorToBase64([220, 220, 220]));
    const [cubeFaces, setCubeFaces] = useState(initialFaces);
    const [imageSrc, setImageSrc] = useState(null);
    const [quality, setQuality] = useState(1);
    const [cubeSize, setCubeSize] = useState(4096);
    const [watermarkInput, setWatermarkInput] = useState("");
    const [watermarkText, setWatermarkText] = useState("");
    const [shouldProcess, setShouldProcess] = useState(false);

    const onUpload = (event) => {
        const file = event.target.files[0];
        const reader = new FileReader();

        reader.onload = function(e) {
            setImageSrc(e.target.result);
        }

        reader.readAsDataURL(file);
    }

    const startProcessing = () => {
        setWatermarkText(watermarkInput);
        setShouldProcess(true);
    }

    const downloadAllAsZip = async () => {
        const zip = new JSZip();

        for (let i = 0; i < cubeFaces.length; i++) {
            const face = cubeFaces[i];
            const dataURL = face.split(',')[1];
            zip.file(`CubeFace${i}.jpeg`, dataURL, { base64: true });
        }

        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, "cubeFaces.zip");
    };

     const [isCubeMapPlayerOpen, setCubeMapPlayerOpen] = useState(false);
    

    const handleThumbnailClick = (face) => {
        setCubeMapPlayerOpen(true);
    };

    return (
        <div>
            <input type="file" onChange={onUpload} />
            <br />
            <label>
                Quality:
                <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    value={quality * 100} 
                    onChange={(e) => setQuality(e.target.value / 100)}
                />
                {Math.round(quality * 100)}
            </label>
            <br />
            <label>
                Cube Size:
                <select value={cubeSize} onChange={(e) => setCubeSize(parseInt(e.target.value))}>
                    <option value={1024}>1024</option>
                    <option value={2048}>2048</option>
                    <option value={4096}>4096</option>
                </select>
            </label>
            <br />
            <label>
                Watermark Text:
                <input 
                    type="text" 
                    value={watermarkInput} 
                    onChange={(e) => setWatermarkInput(e.target.value)}
                />
            </label>
            <br />
            <button onClick={startProcessing}>Start Processing</button>
            <br />
            <Canvas>
                <Cubemap setCubeFaces={setCubeFaces} imageSrc={imageSrc} watermarkText={watermarkText} quality={quality} cubeSize={cubeSize} shouldProcess={shouldProcess} />
                <OrbitControls />
            </Canvas>
            {/* {isCubeMapPlayerOpen && <CubeMapPlayer faces={cubeFaces} onClose={() => setCubeMapPlayerOpen(false)} />}
             */}
            <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(3, 1fr)', 
                        gap: '10px', 
                        width: '810px',
                        alignItems: 'center', 
                        justifyContent: 'center'
                    }}>
                {cubeFaces.map((face, index) => (
                    <div key={index}>
                        {/* <a href="#" onClick={() => handleThumbnailClick(face)}> */}
                            <img src={face} alt={`Cube Face ${index}`} width={128} height={128} />
                        {/* </a> */}
                    </div>
                ))}
            </div>
            <button onClick={downloadAllAsZip}>Download All as Zip</button>
            
        </div>
    );
}

export default App;
