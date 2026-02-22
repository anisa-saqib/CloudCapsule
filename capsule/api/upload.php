<?php
header('Content-Type: application/json');
session_start();

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Not logged in']);
    exit;
}

// Create uploads directory if it doesn't exist
$upload_dir = __DIR__ . '/uploads/';
if (!file_exists($upload_dir)) {
    mkdir($upload_dir, 0755, true);
}

$response = ['urls' => []];

if (!empty($_FILES['photos'])) {
    $files = $_FILES['photos'];
    
    // Handle single or multiple files
    if (!is_array($files['name'])) {
        $files = [
            'name' => [$files['name']],
            'type' => [$files['type']],
            'tmp_name' => [$files['tmp_name']],
            'error' => [$files['error']],
            'size' => [$files['size']]
        ];
    }

    for ($i = 0; $i < count($files['name']); $i++) {
        if ($files['error'][$i] === UPLOAD_ERR_OK) {
            $ext = pathinfo($files['name'][$i], PATHINFO_EXTENSION);
            $filename = 'photo_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
            $destination = $upload_dir . $filename;

            if (move_uploaded_file($files['tmp_name'][$i], $destination)) {
                $response['urls'][] = '/api/uploads/' . $filename;
            }
        }
    }
}

echo json_encode($response);
?>